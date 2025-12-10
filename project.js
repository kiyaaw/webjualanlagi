const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');

const app = express();

// ==== CONFIG EXPRESS ====
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ==== SESSION CONFIG ====
app.use(session({
  secret: 'portal-korupsi-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 jam
}));

// ==== CONFIG DATABASE ====
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '', // ganti sesuai password MySQL-mu
  database: 'portal_korupsi'
});

db.connect((err) => {
  if (err) {
    console.log('Database connection failed!');
    throw err;
  }
  console.log('Database connected!');
});

// ==== MIDDLEWARE ====
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Harus login' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Akses ditolak' });
  }
  next();
}

// ==== ROUTES ====
// halaman utama - SELALU render utama.ejs
app.get('/', (req, res) => {
  res.render('utama');
});

// check session status
app.get('/check-session', (req, res) => {
  if (req.session.user) {
    res.json({ 
      loggedIn: true, 
      user: req.session.user 
    });
  } else {
    res.json({ loggedIn: false });
  }
});

// dashboard page
app.get('/dashboard', requireLogin, (req, res) => {
  res.json({ user: req.session.user });
});

// register
app.post('/register', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.json({ error: 'Isi semua kolom!' });
  }

  db.query(
    'INSERT INTO users (username, password, role) VALUES (?, ?, "user")', 
    [username, password], 
    (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.json({ error: 'Username sudah ada!' });
        }
        return res.json({ error: 'Terjadi kesalahan server' });
      }
      
      // Auto login setelah register
      db.query('SELECT id, username, role FROM users WHERE id = ?', [result.insertId], (err, results) => {
        if (err || results.length === 0) {
          return res.json({ error: 'Registrasi gagal' });
        }
        
        req.session.user = results[0];
        res.json({ 
          success: 'Akun berhasil dibuat!', 
          user: results[0] 
        });
      });
    }
  );
});

// login
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, results) => {
    if (err) return res.json({ error: 'Terjadi kesalahan' });
    if (results.length === 0) return res.json({ error: 'Username/password salah' });
    
    const user = results[0];
    
    // Set session
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };
    
    res.json({ 
      success: 'Login berhasil!',
      user: { 
        id: user.id,
        username: user.username, 
        role: user.role 
      }
    });
  });
});

// logout
app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.json({ error: 'Logout gagal' });
    }
    res.json({ success: 'Logout berhasil' });
  });
});

// kirim laporan
app.post('/laporan', requireLogin, (req, res) => {
  const { nama, email, kategori, laporan } = req.body;
  
  if (!laporan) return res.json({ error: 'Isi laporan!' });
  
  db.query(
    'INSERT INTO laporan (user_id, nama, email, kategori, isi) VALUES (?,?,?,?,?)',
    [req.session.user.id, nama || 'Anonim', email || '-', kategori, laporan], 
    (err, result) => {
      if (err) {
        console.log('Error insert laporan:', err);
        return res.json({ error: 'Gagal kirim laporan' });
      }
      res.json({ success: 'Laporan berhasil dikirim!' });
    }
  );
});

// ambil laporan user
app.get('/laporan/user', requireLogin, (req, res) => {
  db.query(
    'SELECT * FROM laporan WHERE user_id = ? ORDER BY id DESC', 
    [req.session.user.id], 
    (err, results) => {
      if (err) {
        console.log('Error get user laporan:', err);
        return res.json({ error: 'Gagal ambil laporan' });
      }
      res.json(results);
    }
  );
});

// ambil semua laporan (admin only)
app.get('/laporan/all', requireAdmin, (req, res) => {
  db.query(`
    SELECT l.*, u.username 
    FROM laporan l 
    LEFT JOIN users u ON l.user_id = u.id 
    ORDER BY l.id DESC
  `, (err, results) => {
    if (err) {
      console.log('Error get all laporan:', err);
      return res.json({ error: 'Gagal ambil laporan' });
    }
    res.json(results);
  });
});

// ambil detail laporan by ID
app.get('/laporan/:id', requireLogin, (req, res) => {
  const laporanId = req.params.id;
  
  db.query('SELECT * FROM laporan WHERE id = ?', [laporanId], (err, results) => {
    if (err) {
      console.log('Error get laporan detail:', err);
      return res.json({ error: 'Gagal ambil detail laporan' });
    }
    
    if (results.length === 0) {
      return res.json({ error: 'Laporan tidak ditemukan' });
    }
    
    const laporan = results[0];
    
    // Cek apakah user adalah pemilik laporan atau admin
    if (req.session.user.role !== 'admin' && laporan.user_id !== req.session.user.id) {
      return res.json({ error: 'Akses ditolak' });
    }
    
    res.json(laporan);
  });
});

// edit laporan (user bisa edit milik sendiri, admin bisa edit semua)
app.post('/laporan/edit', requireLogin, (req, res) => {
  const { id, nama, email, kategori, isi } = req.body;
  
  // Cek apakah laporan ada dan user berhak mengedit
  db.query('SELECT * FROM laporan WHERE id = ?', [id], (err, results) => {
    if (err || results.length === 0) {
      return res.json({ error: 'Laporan tidak ditemukan' });
    }
    
    const laporan = results[0];
    
    // Cek hak akses: admin bisa edit semua, user hanya bisa edit milik sendiri
    if (req.session.user.role !== 'admin' && laporan.user_id !== req.session.user.id) {
      return res.json({ error: 'Anda tidak berhak mengedit laporan ini' });
    }
    
    // Update laporan
    db.query(
      'UPDATE laporan SET nama=?, email=?, kategori=?, isi=? WHERE id=?',
      [nama, email, kategori, isi, id], 
      (err, result) => {
        if (err) {
          console.log('Error edit laporan:', err);
          return res.json({ error: 'Gagal edit laporan' });
        }
        res.json({ success: 'Laporan berhasil diubah' });
      }
    );
  });
});

// hapus laporan (user bisa hapus milik sendiri, admin bisa hapus semua)
app.post('/laporan/hapus', requireLogin, (req, res) => {
  const { id } = req.body;
  
  // Cek apakah laporan ada dan user berhak menghapus
  db.query('SELECT * FROM laporan WHERE id = ?', [id], (err, results) => {
    if (err || results.length === 0) {
      return res.json({ error: 'Laporan tidak ditemukan' });
    }
    
    const laporan = results[0];
    
    // Cek hak akses: admin bisa hapus semua, user hanya bisa hapus milik sendiri
    if (req.session.user.role !== 'admin' && laporan.user_id !== req.session.user.id) {
      return res.json({ error: 'Anda tidak berhak menghapus laporan ini' });
    }
    
    // Hapus laporan
    db.query('DELETE FROM laporan WHERE id = ?', [id], (err, result) => {
      if (err) {
        console.log('Error delete laporan:', err);
        return res.json({ error: 'Gagal hapus laporan' });
      }
      res.json({ success: 'Laporan dihapus' });
    });
  });
});

// update status laporan (admin only)
app.post('/laporan/status', requireAdmin, (req, res) => {
  const { id, status } = req.body;
  
  db.query(
    'UPDATE laporan SET status=? WHERE id=?',
    [status, id], 
    (err, result) => {
      if (err) {
        console.log('Error update status:', err);
        return res.json({ error: 'Gagal update status' });
      }
      res.json({ success: 'Status berhasil diupdate' });
    }
  );
});

// ==== JALANKAN SERVER ====
const PORT = 3000;
app.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT}`));
