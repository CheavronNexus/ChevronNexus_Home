import os
import time
import socket
import sqlite3
import hashlib
import secrets
import tempfile
import datetime
import mimetypes
import subprocess
from flask import Flask, request, jsonify, send_from_directory, render_template, g, session, Response
from werkzeug.utils import secure_filename

# Resolve ffmpeg binary: prefer static_ffmpeg bundled binary, fall back to system ffmpeg
try:
    import static_ffmpeg
    static_ffmpeg.add_paths()
except Exception:
    pass
import shutil
FFMPEG_BIN = shutil.which('ffmpeg') or 'ffmpeg'

app = Flask(__name__, static_folder='static', template_folder='templates')

# Explicitly register common media mime-types for Windows environment stability
mimetypes.add_type('video/mp4', '.mp4')
mimetypes.add_type('video/webm', '.webm')
mimetypes.add_type('video/ogg', '.ogg')
mimetypes.add_type('video/ogg', '.ogv')
mimetypes.add_type('video/quicktime', '.mov')
mimetypes.add_type('video/x-matroska', '.mkv')
mimetypes.add_type('video/x-msvideo', '.avi')
mimetypes.add_type('video/x-flv', '.flv')
mimetypes.add_type('video/x-ms-wmv', '.wmv')

# Configuration
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024 * 1024  # 100 GB limit for uploads

MOVIE_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'Movie')
app.config['MOVIE_FOLDER'] = MOVIE_FOLDER
os.makedirs(MOVIE_FOLDER, exist_ok=True)

# Session cookie secret (Static so sessions persist across restarts)
app.secret_key = 'chevronnexus_secure_session_key_1298471902847'
app.permanent_session_lifetime = datetime.timedelta(days=30)

# Configure local temporary directory for large uploads
# This prevents Windows 7 system C: drive space constraints from failing uploads
TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'temp')
os.makedirs(TEMP_DIR, exist_ok=True)
tempfile.tempdir = TEMP_DIR

DATABASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'localdrop.db')

# Ensure the upload directory exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Allowed media formats
ALLOWED_EXTENSIONS = {
    # Images
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'heif', 'bmp', 'tiff',
    # Videos
    'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'flv', 'wmv'
}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ==========================================================================
# SECURE PASSWORD HASHING (Standard Library)
# ==========================================================================
def hash_password(password, salt=None):
    """Generate a salted SHA-256 hash of a password."""
    if salt is None:
        salt = secrets.token_hex(16)
    hash_obj = hashlib.sha256((password + salt).encode('utf-8'))
    return f"{hash_obj.hexdigest()}:{salt}"

def verify_password(password, stored_hash):
    """Verify password matches a stored salted SHA-256 hash."""
    try:
        h, salt = stored_hash.split(':')
        return hash_password(password, salt).split(':')[0] == h
    except Exception:
        return False

# ==========================================================================
# DATABASE CONTEXT LIFECYCLE & INITIALIZATION
# ==========================================================================
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE, timeout=30.0)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    """Initialize database tables for authentication, devices, and files."""
    db = sqlite3.connect(DATABASE, timeout=30.0)
    cursor = db.cursor()
    
    # 1. Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT,
            created_at REAL NOT NULL
        )
    ''')
    
    # Migration: add 'name' column safely if database already exists
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN name TEXT")
    except sqlite3.OperationalError:
        pass  # Column already exists
    
    # 2. Create devices table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS devices (
            ip TEXT PRIMARY KEY,
            device_name TEXT NOT NULL,
            last_seen REAL NOT NULL
        )
    ''')
    
    # 3. Create files table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE NOT NULL,
            original_name TEXT NOT NULL,
            size INTEGER NOT NULL,
            category TEXT NOT NULL,
            uploaded_at REAL NOT NULL,
            uploader_ip TEXT NOT NULL,
            uploader_username TEXT NOT NULL,
            FOREIGN KEY (uploader_ip) REFERENCES devices(ip),
            FOREIGN KEY (uploader_username) REFERENCES users(username)
        )
    ''')
    
    db.commit()
    db.close()

def sync_db_with_disk():
    """Synchronize files on disk under device-specific subfolders with DB records."""
    db = sqlite3.connect(DATABASE, timeout=30.0)
    db.row_factory = sqlite3.Row
    cursor = db.cursor()
    
    # Ensure default uploader device exists
    cursor.execute("INSERT OR IGNORE INTO devices (ip, device_name, last_seen) VALUES (?, ?, ?)",
                   ('127.0.0.1', 'Server Host', time.time()))
                   
    # Ensure default uploader user exists
    cursor.execute("SELECT username FROM users WHERE username = ?", ('admin',))
    if not cursor.fetchone():
        hashed = hash_password('admin')
        cursor.execute("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                       ('admin', hashed, time.time()))
    
    disk_files = {} # Maps safe_filename -> uploader_ip
    
    # Read files physically on disk inside each device directory
    if os.path.exists(UPLOAD_FOLDER):
        for entry in os.scandir(UPLOAD_FOLDER):
            if entry.is_dir():
                ip = folder_name_to_ip(entry.name)
                # Ensure device exists in DB
                cursor.execute("INSERT OR IGNORE INTO devices (ip, device_name, last_seen) VALUES (?, ?, ?)",
                               (ip, f"Device-{entry.name}", time.time()))
                
                # Scan device folder
                for file_entry in os.scandir(entry.path):
                    if file_entry.is_file() and allowed_file(file_entry.name):
                        disk_files[file_entry.name] = ip
            elif entry.is_file() and allowed_file(entry.name):
                # Legacy root-level files go to server IP
                disk_files[entry.name] = '127.0.0.1'
                
    # Read files tracked in the database
    cursor.execute('SELECT filename FROM files')
    db_files = {row['filename'] for row in cursor.fetchall()}
    
    # 1. Sync disk files that are missing in DB
    missing_in_db = set(disk_files.keys()) - db_files
    if missing_in_db:
        for filename in missing_in_db:
            ip = disk_files[filename]
            folder_name = get_device_folder_name(ip)
            filepath = os.path.join(UPLOAD_FOLDER, folder_name, filename)
            if not os.path.exists(filepath):
                filepath = os.path.join(UPLOAD_FOLDER, filename) # check legacy root folder
                
            stat = os.stat(filepath)
            ext = filename.rsplit('.', 1)[-1].lower()
            is_video = ext in {'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'flv', 'wmv'}
            category = 'video' if is_video else 'photo'
            
            # Use original filename by removing the IP prefix if present
            orig_name = filename
            prefix = f"{folder_name}_"
            if filename.startswith(prefix):
                orig_name = filename[len(prefix):]
            
            cursor.execute('''
                INSERT INTO files (filename, original_name, size, category, uploaded_at, uploader_ip, uploader_username)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (filename, orig_name, stat.st_size, category, stat.st_mtime, ip, 'admin'))
            
    # 2. Sync database entries that are missing on disk
    missing_on_disk = db_files - set(disk_files.keys())
    for filename in missing_on_disk:
        cursor.execute('DELETE FROM files WHERE filename = ?', (filename,))
        
    db.commit()
    db.close()

# ==========================================================================
# DEVICE REGISTRATION HELPERS
# ==========================================================================
def get_or_create_device(ip):
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT device_name FROM devices WHERE ip = ?', (ip,))
    row = cursor.fetchone()
    
    if row:
        cursor.execute('UPDATE devices SET last_seen = ? WHERE ip = ?', (time.time(), ip))
        db.commit()
        return row['device_name']
    else:
        if ip in ('127.0.0.1', '::1'):
            device_name = "Server Host"
        else:
            parts = ip.split('.')
            suffix = '.'.join(parts[-2:]) if len(parts) >= 2 else ip
            device_name = f"Device-{suffix}"
            
        cursor.execute('INSERT INTO devices (ip, device_name, last_seen) VALUES (?, ?, ?)',
                       (ip, device_name, time.time()))
        db.commit()
        return device_name

def get_local_ips():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    if not ips:
        ips = ["127.0.0.1"]
    return list(set(ips))

def get_device_folder_name(ip):
    """Sanitize IP address to be Windows folder-safe (replaces IPv6 colons)."""
    return ip.replace(':', '_')

def folder_name_to_ip(folder_name):
    """Restore sanitized folder name to original IP representation."""
    if '_' in folder_name and '.' not in folder_name:
        return folder_name.replace('_', ':')
    return folder_name

def get_safe_filename(filename, device_ip):
    """Generate a globally unique filename prefixed with device IP and check existence inside the device subfolder."""
    base, ext = os.path.splitext(filename)
    safe_base = secure_filename(base)
    if not safe_base:
        safe_base = f"media_{int(time.time() * 1000)}"
    
    # Prefix to guarantee database unique constraint is satisfied globally
    ip_prefix = get_device_folder_name(device_ip)
    final_filename = f"{ip_prefix}_{safe_base}{ext.lower()}"
    
    device_folder = os.path.join(app.config['UPLOAD_FOLDER'], ip_prefix)
    os.makedirs(device_folder, exist_ok=True)
    
    counter = 1
    while os.path.exists(os.path.join(device_folder, final_filename)):
        final_filename = f"{ip_prefix}_{safe_base}_{counter}{ext.lower()}"
        counter += 1
    return final_filename

# ==========================================================================
# AUTHENTICATION ROUTING
# ==========================================================================
@app.route('/')
def index():
    """Serves the authentication portal if not logged in, otherwise serves the ChevronNexus media dashboard."""
    if 'username' not in session:
        return render_template('auth.html')
    return render_template('index.html')

@app.route('/api/auth/register', methods=['POST'])
def register():
    """Register a new user account along with their name and device name."""
    data = request.get_json() or {}
    username = data.get('username', '').strip().lower()
    password = data.get('password', '').strip()
    name = data.get('name', '').strip()
    device_name = data.get('device_name', '').strip()
    
    if len(username) < 3 or len(username) > 15:
        return jsonify({'error': 'Username must be between 3 and 15 characters.'}), 400
    if len(password) < 4:
        return jsonify({'error': 'Password must be at least 4 characters long.'}), 400
    if not name:
        return jsonify({'error': 'Full name is required.'}), 400
    if not device_name:
        return jsonify({'error': 'Device name is required.'}), 400
        
    db = get_db()
    cursor = db.cursor()
    
    try:
        password_hash = hash_password(password)
        cursor.execute('INSERT INTO users (username, password_hash, name, created_at) VALUES (?, ?, ?, ?)',
                       (username, password_hash, name, time.time()))
        
        # Also register the device
        ip = request.remote_addr
        cursor.execute('''
            INSERT INTO devices (ip, device_name, last_seen)
            VALUES (?, ?, ?)
            ON CONFLICT(ip) DO UPDATE SET device_name = excluded.device_name, last_seen = excluded.last_seen
        ''', (ip, device_name, time.time()))
        
        db.commit()
        
        # Auto-login upon registration
        session.permanent = True
        session['username'] = username
        return jsonify({'success': True, 'username': username})
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Username is already taken.'}), 409
    except Exception as e:
        return jsonify({'error': f'Registration failed: {str(e)}'}), 500

@app.route('/api/auth/login', methods=['POST'])
def login():
    """Log in an existing user."""
    data = request.get_json() or {}
    username = data.get('username', '').strip().lower()
    password = data.get('password', '').strip()
    
    if not username or not password:
        return jsonify({'error': 'Please provide both username and password.'}), 400
        
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute('SELECT password_hash FROM users WHERE username = ?', (username,))
    row = cursor.fetchone()
    
    if row and verify_password(password, row['password_hash']):
        session.permanent = True
        session['username'] = username
        return jsonify({'success': True, 'username': username})
    else:
        return jsonify({'error': 'Invalid username or password.'}), 401

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    """Log out the current user session."""
    session.pop('username', None)
    return jsonify({'success': True})

@app.route('/api/auth/session', methods=['GET'])
def get_session():
    """Retrieve active session details including Full Name."""
    if 'username' in session:
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT name FROM users WHERE username = ?', (session['username'],))
        row = cursor.fetchone()
        name = row['name'] if (row and row['name']) else session['username']
        return jsonify({
            'logged_in': True, 
            'username': session['username'],
            'name': name
        })
    return jsonify({'logged_in': False})

# ==========================================================================
# FILE MANAGEMENT ROUTING (GUARDED BY AUTH SESSION)
# ==========================================================================
@app.route('/api/ips', methods=['GET'])
def get_ips():
    # Publicly accessible for QR code network detection
    return jsonify({
        'ips': get_local_ips(),
        'port': app.config.get('PORT', 5000)
    })

@app.route('/api/device', methods=['GET'])
def check_device():
    if 'username' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    ip = request.remote_addr
    device_name = get_or_create_device(ip)
    return jsonify({
        'ip': ip,
        'device_name': device_name
    })

@app.route('/api/device/register', methods=['POST'])
def register_device():
    if 'username' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    ip = request.remote_addr
    data = request.get_json() or {}
    device_name = data.get('device_name', '').strip()
    
    if not device_name:
        return jsonify({'error': 'Device name cannot be empty'}), 400
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''
        INSERT INTO devices (ip, device_name, last_seen)
        VALUES (?, ?, ?)
        ON CONFLICT(ip) DO UPDATE SET device_name = excluded.device_name, last_seen = excluded.last_seen
    ''', (ip, device_name, time.time()))
    db.commit()
    return jsonify({'success': True, 'device_name': device_name})

@app.route('/api/files', methods=['GET'])
def list_files():
    if 'username' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        db = get_db()
        cursor = db.cursor()
        uploader_ip = request.remote_addr
        
        # Only return files uploaded by the requesting device
        cursor.execute('''
            SELECT f.filename, f.original_name, f.size, f.category, f.uploaded_at, f.uploader_ip, f.uploader_username,
                   COALESCE(d.device_name, 'Unknown Device') as uploader_name
            FROM files f
            LEFT JOIN devices d ON f.uploader_ip = d.ip
            WHERE f.uploader_ip = ?
            ORDER BY f.uploaded_at DESC
        ''', (uploader_ip,))
        
        files_list = []
        for row in cursor.fetchall():
            files_list.append({
                'name': row['filename'],
                'original_name': row['original_name'],
                'size': row['size'],
                'category': row['category'],
                'uploaded_at': row['uploaded_at'],
                'uploader_ip': row['uploader_ip'],
                'uploader_username': row['uploader_username'],
                'uploader_name': row['uploader_name'],
                'url': f'/uploads/{row["filename"]}'
            })
            
        return jsonify({'files': files_list})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/upload', methods=['POST'])
def upload_files():
    if 'username' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
        
    if 'files' not in request.files:
        return jsonify({'error': 'No file part in request'}), 400
        
    files = request.files.getlist('files')
    uploader_ip = request.remote_addr
    uploader_username = session['username']
    
    get_or_create_device(uploader_ip)
    
    db = get_db()
    cursor = db.cursor()
    uploaded_files = []
    errors = []
    
    device_folder_name = get_device_folder_name(uploader_ip)
    device_folder = os.path.join(app.config['UPLOAD_FOLDER'], device_folder_name)
    os.makedirs(device_folder, exist_ok=True)

    for file in files:
        if file.filename == '':
            continue
            
        if file and allowed_file(file.filename):
            safe_name = get_safe_filename(file.filename, uploader_ip)
            filepath = os.path.join(device_folder, safe_name)
            try:
                file.save(filepath)
                
                ext = file.filename.rsplit('.', 1)[1].lower()
                is_video = ext in {'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'flv', 'wmv'}
                category = 'video' if is_video else 'photo'
                
                cursor.execute('''
                    INSERT INTO files (filename, original_name, size, category, uploaded_at, uploader_ip, uploader_username)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (safe_name, file.filename, os.path.getsize(filepath), category, time.time(), uploader_ip, uploader_username))
                
                uploaded_files.append(safe_name)
            except Exception as e:
                errors.append({file.filename: str(e)})
        else:
            errors.append({file.filename: 'File extension not allowed'})

    if uploaded_files:
        db.commit()
        return jsonify({
            'success': True,
            'uploaded': uploaded_files,
            'errors': errors
        }), 200
    else:
        return jsonify({
            'success': False,
            'error': 'No valid files were uploaded',
            'errors': errors
        }), 400

@app.route('/api/files/<path:filename>', methods=['DELETE'])
def delete_file(filename):
    if 'username' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
        
    safe_name = secure_filename(os.path.basename(filename))
    uploader_ip = request.remote_addr
    device_folder = os.path.join(app.config['UPLOAD_FOLDER'], get_device_folder_name(uploader_ip))
    filepath = os.path.normpath(os.path.join(device_folder, safe_name))
    
    if not filepath.startswith(device_folder):
        return jsonify({'error': 'Unauthorized directory traversal detected'}), 403

    db = get_db()
    cursor = db.cursor()
    
    cursor.execute('SELECT filename FROM files WHERE filename = ? AND uploader_ip = ?', (safe_name, uploader_ip))
    row = cursor.fetchone()
    
    db_exists = row is not None
    disk_exists = os.path.exists(filepath)

    if db_exists or disk_exists:
        try:
            if disk_exists:
                os.remove(filepath)
            if db_exists:
                cursor.execute('DELETE FROM files WHERE filename = ? AND uploader_ip = ?', (safe_name, uploader_ip))
                db.commit()
            return jsonify({'success': True, 'message': f'{safe_name} deleted successfully.'})
        except PermissionError as e:
            app.logger.error(f"PermissionError deleting file: {str(e)}")
            return jsonify({
                'error': 'This file is currently in use. Please close the player and try again.'
            }), 423
        except Exception as e:
            app.logger.error(f"Error during file deletion: {str(e)}")
            return jsonify({'error': 'Failed to delete file.'}), 500
    else:
        return jsonify({'error': 'File not found'}), 404

# ==========================================================================
# MOVIE LIBRARY ROUTING (GUARDED BY AUTH SESSION OR TEMP STREAM TOKENS)
# ==========================================================================
# Memory storage for temporary movie streaming tokens (for external players)
# Maps token -> (movie_filename, expiry_timestamp)
MOVIE_TOKENS = {}

def generate_movie_token(filename):
    """Generate a temporary 24-hour token for external player streaming."""
    token = secrets.token_hex(16)
    expiry = time.time() + 24 * 3600
    MOVIE_TOKENS[token] = (filename, expiry)
    
    # Clean up expired tokens
    now = time.time()
    expired = [t for t, v in list(MOVIE_TOKENS.items()) if v[1] < now]
    for t in expired:
        MOVIE_TOKENS.pop(t, None)
    return token

def verify_movie_token(token, filename):
    """Verify if a stream token is valid for the requested file."""
    if not token or token not in MOVIE_TOKENS:
        return False
    stored_filename, expiry = MOVIE_TOKENS[token]
    if time.time() > expiry:
        MOVIE_TOKENS.pop(token, None)
        return False
    # Ensure it matches normalized filename path
    return os.path.normpath(stored_filename) == os.path.normpath(filename)
@app.route('/api/movies', methods=['GET'])
def list_movies():
    if 'username' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        movies_list = []
        movie_folder = app.config['MOVIE_FOLDER']
        if os.path.exists(movie_folder):
            for entry in os.scandir(movie_folder):
                if entry.is_file() and not entry.name.startswith('.'):
                    file = entry.name
                    ext = file.rsplit('.', 1)[-1].lower() if '.' in file else ''
                    stat = entry.stat()
                    movies_list.append({
                        'name': file,
                        'relative_path': file,
                        'size': stat.st_size,
                        'format': ext.upper() if ext else 'UNKNOWN',
                        'modified_at': stat.st_mtime
                    })
        return jsonify({'movies': movies_list})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def get_media_codecs(filepath):
    """Probes the media file using ffprobe to get its video and audio codecs."""
    import subprocess
    try:
        import static_ffmpeg
        static_ffmpeg.add_paths()
    except Exception:
        pass
        
    cmd = [
        'ffprobe',
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filepath
    ]
    cmd_audio = [
        'ffprobe',
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filepath
    ]
    
    video_codec = None
    audio_codec = None
    try:
        video_codec = subprocess.check_output(cmd, text=True, timeout=2.0).strip()
    except Exception:
        pass
    try:
        audio_codec = subprocess.check_output(cmd_audio, text=True, timeout=2.0).strip()
    except Exception:
        pass
    return video_codec, audio_codec

def get_audio_tracks(filepath):
    """Probes ALL audio streams from a media file. Returns list of dicts."""
    import subprocess, json
    try:
        import static_ffmpeg
        static_ffmpeg.add_paths()
    except Exception:
        pass
    
    cmd = [
        'ffprobe',
        '-v', 'error',
        '-select_streams', 'a',
        '-show_entries', 'stream=index,codec_name,codec_long_name,channels,sample_rate:stream_tags=language,title,handler_name',
        '-of', 'json',
        filepath
    ]
    
    tracks = []
    try:
        output = subprocess.check_output(cmd, text=True, timeout=5.0)
        data = json.loads(output)
        for i, stream in enumerate(data.get('streams', [])):
            tags = stream.get('tags', {})
            lang = tags.get('language', '')
            title = tags.get('title', '') or tags.get('handler_name', '')
            codec = stream.get('codec_name', 'unknown')
            channels = stream.get('channels', 0)
            
            # Build a user-friendly label
            label_parts = []
            if title:
                label_parts.append(title)
            if lang and lang != 'und':
                label_parts.append(lang.upper())
            
            ch_label = ''
            if channels == 1: ch_label = 'Mono'
            elif channels == 2: ch_label = 'Stereo'
            elif channels == 6: ch_label = '5.1'
            elif channels == 8: ch_label = '7.1'
            elif channels > 0: ch_label = f'{channels}ch'
            
            codec_label = codec.upper()
            if codec == 'ac3': codec_label = 'Dolby Digital'
            elif codec == 'eac3': codec_label = 'Dolby Digital+'
            elif codec == 'truehd': codec_label = 'TrueHD'
            elif codec == 'dts': codec_label = 'DTS'
            elif codec == 'aac': codec_label = 'AAC'
            elif codec == 'mp3': codec_label = 'MP3'
            elif codec == 'opus': codec_label = 'Opus'
            elif codec == 'flac': codec_label = 'FLAC'
            
            if ch_label:
                codec_label += f' {ch_label}'
            
            if label_parts:
                label = ' - '.join(label_parts) + f' ({codec_label})'
            else:
                label = f'Track {i + 1} ({codec_label})'
            
            tracks.append({
                'index': i,
                'stream_index': stream.get('index', i),
                'codec': codec,
                'channels': channels,
                'language': lang,
                'title': title,
                'label': label
            })
    except Exception:
        pass
    
    return tracks

@app.route('/movies/<path:filename>')
def serve_movie(filename):
    # Authenticate via browser session or temporary streaming token (for external players)
    is_authorized = 'username' in session
    if not is_authorized:
        token = request.args.get('token')
        if token and verify_movie_token(token, filename):
            is_authorized = True
            
    if not is_authorized:
        return "Unauthorized", 401
        
    safe_path = os.path.normpath(filename).replace('\\', '/')
    # Block directory traversal
    if safe_path.startswith('..') or safe_path.startswith('/'):
        return "Unauthorized path", 403
        
    filepath = os.path.join(app.config['MOVIE_FOLDER'], safe_path)
    is_uploaded_file = False
    uploader_ip = None
    
    if not os.path.exists(filepath):
        # Fallback to uploads folder by querying the database for uploader_ip
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT uploader_ip FROM files WHERE filename = ?', (safe_path,))
        row = cursor.fetchone()
        if row:
            uploader_ip = row['uploader_ip']
            uploads_filepath = os.path.normpath(os.path.join(app.config['UPLOAD_FOLDER'], get_device_folder_name(uploader_ip), safe_path))
            if uploads_filepath.startswith(app.config['UPLOAD_FOLDER']) and os.path.exists(uploads_filepath):
                filepath = uploads_filepath
                is_uploaded_file = True

    if not os.path.exists(filepath):
        return "File not found", 404
    
    as_attachment = request.args.get('download') == '1'
    if as_attachment:
        original_name = os.path.basename(safe_path)
        if is_uploaded_file and uploader_ip:
            db = get_db()
            cursor = db.cursor()
            cursor.execute('SELECT original_name FROM files WHERE filename = ?', (safe_path,))
            row = cursor.fetchone()
            if row and row['original_name']:
                original_name = row['original_name']
            device_folder = os.path.join(app.config['UPLOAD_FOLDER'], get_device_folder_name(uploader_ip))
            return send_from_directory(device_folder, safe_path, as_attachment=True, download_name=original_name)
        return send_from_directory(app.config['MOVIE_FOLDER'], safe_path, as_attachment=True, download_name=original_name)
        
    # Check if this request is from an external player (VLC, PotPlayer, MPV, etc.)
    user_agent = request.headers.get('User-Agent', '').lower()
    is_external_player = any(player in user_agent for player in ['vlc', 'potplayer', 'mpv', 'kodi', 'wlc', 'stagefright', 'okhttp'])
    
    # Determine if transcoding/remuxing is needed for browser playability
    ext = os.path.splitext(safe_path)[1].lower()
    needs_transcoding = ext in ['.mkv', '.avi', '.flv', '.wmv']
    
    # If the file is in a compatible format but has Dolby/DTS audio, we also transcode it
    video_codec, audio_codec = None, None
    if not needs_transcoding and not is_external_player:
        video_codec, audio_codec = get_media_codecs(filepath)
        # Dolby/DTS audio codecs include: ac3, eac3, dts, truehd, mlp
        if audio_codec in ['ac3', 'eac3', 'dts', 'truehd', 'mlp']:
            needs_transcoding = True
            
    # Force transcode/raw override parameters
    if request.args.get('transcode') == '1':
        needs_transcoding = True
    elif request.args.get('raw') == '1':
        needs_transcoding = False
        
    audio_only = request.args.get('audio_only') == '1'
    if audio_only:
        needs_transcoding = True
        
    if needs_transcoding and not is_external_player:
        # Get start time parameter for seeking (in seconds)
        start_time = request.args.get('start', '0')
        
        # Build FFmpeg command
        cmd = ['ffmpeg']
        if start_time != '0':
            # Fast seek input
            cmd += ['-ss', start_time]
            
        cmd += ['-i', filepath]
        
        # Select specific audio track if requested
        audio_track_idx = request.args.get('atrack', '0')
        try:
            audio_track_idx = int(audio_track_idx)
        except (ValueError, TypeError):
            audio_track_idx = 0
        
        # Map streams based on whether we are streaming audio only
        if audio_only:
            cmd += ['-map', f'0:a:{audio_track_idx}', '-vn']
        else:
            cmd += ['-map', '0:v:0', '-map', f'0:a:{audio_track_idx}']
        
        # Determine codecs to copy/transcode
        if not video_codec or not audio_codec:
            video_codec, audio_codec = get_media_codecs(filepath)
        
        # Check the specific audio track's codec for the selected track
        selected_audio_codec = audio_codec  # default to first track
        try:
            all_tracks = get_audio_tracks(filepath)
            if audio_track_idx < len(all_tracks):
                selected_audio_codec = all_tracks[audio_track_idx].get('codec', audio_codec)
        except Exception:
            pass
            
        # Copy or transcode video only if we aren't in audio_only mode
        if not audio_only:
            if video_codec in ['h264', 'hevc', 'vp9', 'av1']:
                cmd += ['-c:v', 'copy']
            else:
                cmd += ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23']
            
        # Transcode Dolby/DTS/unsupported audio to stereo AAC, copy if already compatible
        if selected_audio_codec in ['aac', 'mp3', 'opus', 'vorbis']:
            cmd += ['-c:a', 'copy']
        else:
            cmd += ['-c:a', 'aac', '-b:a', '192k', '-ac', '2']
            
        cmd += [
            '-f', 'mp4',
            '-movflags', 'frag_keyframe+empty_moov+faststart',
            'pipe:1'
        ]
        
        cmd[0] = FFMPEG_BIN
            
        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=10**6
            )
        except (FileNotFoundError, OSError) as e:
            print(f"[WARNING] Failed to start ffmpeg subprocess: {e}")
            # For audio_only requests, raw file fallback won't work on mobile browsers
            # Return 503 so the remote client knows transcoding failed
            if audio_only:
                return "FFmpeg not available for audio transcoding", 503
            print("Directly serving the raw movie file as a fallback.")
            if is_uploaded_file and uploader_ip:
                device_folder = os.path.join(app.config['UPLOAD_FOLDER'], get_device_folder_name(uploader_ip))
                return send_from_directory(device_folder, safe_path)
            return send_from_directory(app.config['MOVIE_FOLDER'], safe_path)
            
        def generate():
            try:
                while True:
                    data = process.stdout.read(65536) # 64KB chunks
                    if not data:
                        break
                    yield data
            finally:
                try:
                    process.terminate()
                    process.wait(timeout=1.0)
                except Exception:
                    try:
                        process.kill()
                    except Exception:
                        pass
                        
        from flask import Response
        return Response(generate(), mimetype='audio/mpeg' if audio_only else 'video/mp4', headers={
            'Accept-Ranges': 'none',
        })
        
    if is_uploaded_file and uploader_ip:
        device_folder = os.path.join(app.config['UPLOAD_FOLDER'], get_device_folder_name(uploader_ip))
        return send_from_directory(device_folder, safe_path)
    return send_from_directory(app.config['MOVIE_FOLDER'], safe_path)


@app.route('/api/movies/upload', methods=['POST'])
def upload_movies():
    """Endpoint for uploading movies directly to the Movie directory without device subfolders."""
    if 'username' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
        
    if 'files' not in request.files:
        return jsonify({'error': 'No file part in request'}), 400
        
    files = request.files.getlist('files')
    uploaded_movies = []
    errors = []
    
    os.makedirs(app.config['MOVIE_FOLDER'], exist_ok=True)
    
    for file in files:
        if file.filename == '':
            continue
            
        ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file else ''
        safe_name = secure_filename(os.path.basename(file.filename))
        if not safe_name:
            safe_name = f"movie_{int(time.time() * 1000)}"
            if ext:
                safe_name += f".{ext}"
                
        filepath = os.path.join(app.config['MOVIE_FOLDER'], safe_name)
        # Ensure unique filename on disk inside the Movie folder
        base, ext_with_dot = os.path.splitext(safe_name)
        counter = 1
        while os.path.exists(filepath):
            safe_name = f"{base}_{counter}{ext_with_dot}"
            filepath = os.path.join(app.config['MOVIE_FOLDER'], safe_name)
            counter += 1
            
        try:
            # Ensure the stream is positioned at the beginning to prevent 0-byte writes
            file.stream.seek(0)
            try:
                file.seek(0)
            except Exception:
                pass
            # Chunked saving for large uploads to prevent memory issues and 0-byte saves
            with open(filepath, 'wb') as f:
                chunk_size = 4 * 1024 * 1024  # 4 MB chunks
                while True:
                    chunk = file.stream.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
            
            # Verify file size is greater than 0
            if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
                uploaded_movies.append(safe_name)
            else:
                if os.path.exists(filepath):
                    os.remove(filepath)
                errors.append({file.filename: 'Saved file was empty (0 bytes).'})
        except Exception as e:
            if os.path.exists(filepath):
                os.remove(filepath)
            errors.append({file.filename: str(e)})
            
    if uploaded_movies:
        return jsonify({
            'success': True,
            'uploaded': uploaded_movies,
            'errors': errors
        }), 200
    else:
        return jsonify({
            'success': False,
            'error': 'No valid files were uploaded',
            'errors': errors
        }), 400

@app.route('/api/movies/<path:filename>', methods=['DELETE'])
def delete_movie(filename):
    if 'username' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
        
    safe_name = secure_filename(os.path.basename(filename))
    filepath = os.path.normpath(os.path.join(app.config['MOVIE_FOLDER'], safe_name))
    
    if not filepath.startswith(app.config['MOVIE_FOLDER']):
        return jsonify({'error': 'Unauthorized directory traversal detected'}), 403

    if os.path.exists(filepath):
        try:
            os.remove(filepath)
            return jsonify({'success': True, 'message': f'{safe_name} deleted successfully.'})
        except PermissionError as e:
            app.logger.error(f"PermissionError deleting movie: {str(e)}")
            return jsonify({
                'error': 'This movie is currently in use or playing. Please close the player and try again.'
            }), 423
        except Exception as e:
            app.logger.error(f"Error during movie deletion: {str(e)}")
            return jsonify({'error': 'Failed to delete movie.'}), 500
    else:
        return jsonify({'error': 'Movie file not found'}), 404

@app.route('/player/<path:filename>')
def movie_player(filename):
    if 'username' not in session:
        return render_template('auth.html')
    safe_path = os.path.normpath(filename)
    # Block directory traversal
    if safe_path.startswith('..') or safe_path.startswith('/') or safe_path.startswith('\\'):
        return "Unauthorized path", 403
    movie_name = os.path.splitext(os.path.basename(safe_path))[0]
    
    # Generate temporary streaming token for external players
    token = generate_movie_token(filename)
    
    filepath = os.path.join(app.config['MOVIE_FOLDER'], safe_path)
    if not os.path.exists(filepath):
        # Fallback to uploads folder by querying the database for uploader_ip
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT uploader_ip FROM files WHERE filename = ?', (safe_path,))
        row = cursor.fetchone()
        if row:
            uploader_ip = row['uploader_ip']
            uploads_filepath = os.path.normpath(os.path.join(app.config['UPLOAD_FOLDER'], get_device_folder_name(uploader_ip), safe_path))
            if uploads_filepath.startswith(app.config['UPLOAD_FOLDER']) and os.path.exists(uploads_filepath):
                filepath = uploads_filepath
    
    # Determine MIME type
    ext = os.path.splitext(safe_path)[1].lower()
    mime_type = mimetypes.types_map.get(ext, 'video/mp4')
    
    # Probe duration and audio codec
    duration = 0
    audio_codec = None
    try:
        import subprocess
        try:
            import static_ffmpeg
            static_ffmpeg.add_paths()
        except Exception:
            pass
            
        cmd_duration = [
            'ffprobe',
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            filepath
        ]
        duration = float(subprocess.check_output(cmd_duration, text=True, timeout=2.0).strip())
    except Exception:
        pass
        
    try:
        _, audio_codec = get_media_codecs(filepath)
    except Exception:
        pass
    
    # Probe all audio tracks for the audio track selector
    audio_tracks = []
    try:
        audio_tracks = get_audio_tracks(filepath)
    except Exception:
        pass
        
    # URL encode filename for safe browser requesting
    import urllib.parse
    movie_path_encoded = urllib.parse.quote(filename.replace('\\', '/'))
    
    return render_template('player.html', 
                           movie_path=filename.replace('\\', '/'), 
                           movie_path_encoded=movie_path_encoded,
                           movie_title=movie_name,
                           mime_type=mime_type,
                           audio_codec=audio_codec or '',
                           audio_tracks=audio_tracks,
                           duration=duration,
                           stream_token=token)

@app.route('/theater')
def home_theater():
    if 'username' not in session:
        return render_template('auth.html')
    return render_template('theater.html')

@app.route('/remote')
def tv_remote():
    # Accessible to anyone on the same local Wi-Fi network to control the TV / projector player
    return render_template('remote.html')

import queue

# Dictionary mapping room_code -> list of active queues for clients
ROOM_QUEUES = {}

@app.route('/api/player/stream/<room_code>')
def player_stream(room_code):
    def event_generator():
        q = queue.Queue()
        if room_code not in ROOM_QUEUES:
            ROOM_QUEUES[room_code] = []
        ROOM_QUEUES[room_code].append(q)
        
        try:
            # Send initial connection success event
            yield f"data: Connected to room {room_code}\n\n"
            while True:
                try:
                    # Block until a command arrives; timeout every 25s for keepalive pings
                    cmd = q.get(timeout=25.0)
                    yield f"data: {cmd}\n\n"
                except queue.Empty:
                    # Keep connection alive
                    yield "data: ping\n\n"
        finally:
            # Clean up client queues upon disconnection
            if room_code in ROOM_QUEUES:
                if q in ROOM_QUEUES[room_code]:
                    ROOM_QUEUES[room_code].remove(q)
                if not ROOM_QUEUES[room_code]:
                    ROOM_QUEUES.pop(room_code, None)

    return app.response_class(event_generator(), mimetype='text/event-stream')

@app.route('/api/player/command/<room_code>', methods=['POST'])
def player_command(room_code):
    data = request.get_json() or {}
    command = data.get('command')
    value = data.get('value', '')
    
    if not command:
        return jsonify({'error': 'Command is required'}), 400
        
    # Forward command payload to all EventSource clients listening in this room
    if room_code in ROOM_QUEUES:
        cmd_str = f"{command}:{value}" if value != '' else command
        for q in ROOM_QUEUES[room_code]:
            q.put(cmd_str)
        return jsonify({'success': True})
        
    return jsonify({'error': 'Active player session not found in this room'}), 404

@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    if 'username' not in session:
        return "Unauthorized", 401
    safe_name = secure_filename(os.path.basename(filename))
    uploader_ip = request.remote_addr
    device_folder = os.path.join(app.config['UPLOAD_FOLDER'], get_device_folder_name(uploader_ip))
    
    # Enable downloaded filenames to use their original_name when requested as download
    as_attachment = request.args.get('download') == '1'
    if as_attachment:
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT original_name FROM files WHERE filename = ? AND uploader_ip = ?', (safe_name, uploader_ip))
        row = cursor.fetchone()
        if row and row['original_name']:
            return send_from_directory(device_folder, safe_name, as_attachment=True, download_name=row['original_name'])
            
    return send_from_directory(device_folder, safe_name)

def flatten_movie_folder():
    """Flatten the Movie directory by moving any files in subdirectories to the root and deleting subdirectories."""
    if not os.path.exists(MOVIE_FOLDER):
        return
    print("[INFO] Flattening Movie folder structure...")
    for root, dirs, files in os.walk(MOVIE_FOLDER, topdown=False):
        if root == MOVIE_FOLDER:
            continue
        for file in files:
            src_path = os.path.join(root, file)
            dest_name = file
            dest_path = os.path.join(MOVIE_FOLDER, dest_name)
            base, ext = os.path.splitext(dest_name)
            counter = 1
            while os.path.exists(dest_path):
                dest_name = f"{base}_{counter}{ext}"
                dest_path = os.path.join(MOVIE_FOLDER, dest_name)
                counter += 1
            try:
                print(f"[INFO] Moving {src_path} -> {dest_path}")
                os.rename(src_path, dest_path)
            except Exception as e:
                print(f"[ERROR] Failed to move {src_path} to root: {e}")
        try:
            os.rmdir(root)
            print(f"[INFO] Deleted empty subdirectory: {root}")
        except Exception as e:
            print(f"[WARNING] Could not delete directory {root}: {e}")

if __name__ == '__main__':
    print("[INFO] Initializing SQLite database...")
    init_db()
    print("[INFO] Syncing files directory with database...")
    sync_db_with_disk()
    print("[INFO] Flattening Movie folder directory structure...")
    flatten_movie_folder()
    
    ips = get_local_ips()
    
    # Try standard HTTP port 80 first so chevronnexus.com works without port numbers
    port = 80
    try:
        test_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        test_sock.bind(('0.0.0.0', port))
        test_sock.close()
    except Exception:
        print("[WARNING] Port 80 is occupied or restricted. Falling back to port 5000...")
        port = 5000
        
    print("\n" + "="*60)
    print("  ChevronNexus Server is starting up!")
    print(f"  Access the dashboard on this PC: http://localhost{'' if port == 80 else f':{port}'}")
    print("  Access the dashboard from other devices on the same Wi-Fi:")
    for ip in ips:
        print(f"    * http://{ip}{'' if port == 80 else f':{port}'}")
    print("="*60 + "\n")
    
    app.config['PORT'] = port
    app.run(host='0.0.0.0', port=port, debug=False)
