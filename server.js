import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Dynamic routing middleware for clean HTML URLs
app.use((req, res, next) => {
  let reqPath = req.path;
  
  // If requesting root, default to /index
  if (reqPath === '/') {
    reqPath = '/index';
  }

  // Remove trailing slash if present
  if (reqPath.endsWith('/') && reqPath.length > 1) {
    reqPath = reqPath.slice(0, -1);
  }

  // Check if a direct file exists
  const absolutePathWithHtml = path.join(__dirname, reqPath + '.html');
  const absolutePathDirect = path.join(__dirname, reqPath);

  // If path ends with .html or has an extension, let normal static handling happen
  if (path.extname(reqPath)) {
    return next();
  }

  // Try serving [path].html
  if (fs.existsSync(absolutePathWithHtml) && fs.statSync(absolutePathWithHtml).isFile()) {
    return res.sendFile(absolutePathWithHtml);
  }

  // Try serving [path]/index.html
  const indexPath = path.join(absolutePathDirect, 'index.html');
  if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
    return res.sendFile(indexPath);
  }

  next();
});

// Serve custom.css from local file, redirect other css files to CDNs
app.get('/css/custom.css', (req, res) => {
  const customCssPath = path.join(__dirname, 'css', 'custom.css');
  if (fs.existsSync(customCssPath)) {
    res.sendFile(customCssPath);
  } else {
    res.type('css').send('/* Custom CSS Placeholder */');
  }
});

app.get('/css/bootstrap.min.css', (req, res) => {
  res.redirect('https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css');
});

app.get('/css/slicknav.min.css', (req, res) => {
  res.redirect('https://cdnjs.cloudflare.com/ajax/libs/SlickNav/1.0.10/slicknav.min.css');
});

app.get('/css/swiper-bundle.min.css', (req, res) => {
  res.redirect('https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css');
});

app.get('/css/all.min.css', (req, res) => {
  res.redirect('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css');
});

app.get('/css/animate.css', (req, res) => {
  res.redirect('https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css');
});

app.get('/css/magnific-popup.css', (req, res) => {
  res.redirect('https://cdnjs.cloudflare.com/ajax/libs/magnific-popup.js/1.1.0/magnific-popup.min.css');
});

// JSON body parsing middleware for API routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const STORE_PATH = path.join(__dirname, 'data', 'store.json');

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return { users: [], signup_requests: [], transactions: [] };
    }
    const data = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading store:', err);
    return { users: [], signup_requests: [], transactions: [] };
  }
}

function writeStore(data) {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing store:', err);
  }
}

// Real API endpoint for contact form submission
app.post(['/js/ggg.php', '/api/contact'], (req, res) => {
  console.log('Contact form submission received:', req.body);
  // Send back success to the AJAX submit handler
  res.setHeader('Content-Type', 'text/html');
  res.send('success');
});

// POST /app/user/register (User signup request)
app.post('/app/user/register', (req, res) => {
  const { name, email, username, phone, password } = req.body;
  if (!name || !email || !username || !phone || !password) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  const store = readStore();
  
  // Check if email already registered as user or request
  const emailExists = store.users.some(u => u.email.toLowerCase() === email.toLowerCase()) || 
                      store.signup_requests.some(r => r.email.toLowerCase() === email.toLowerCase());
  
  if (emailExists) {
    return res.status(400).json({ success: false, message: 'Email is already registered or has a pending signup request.' });
  }

  const newRequest = {
    id: 'req_' + Date.now(),
    name,
    email,
    username,
    phone,
    password,
    created_at: new Date().toISOString(),
    message: `User ${name} wants to create an account`
  };

  store.signup_requests.push(newRequest);
  writeStore(store);

  console.log(`Signup request received from user: ${name} (${email})`);
  return res.json({ 
    success: true, 
    message: 'Your registration request has been submitted to the Admin. The administrator will contact you shortly to activate your account.' 
  });
});

// POST /app/user/login (User & Admin login)
app.post('/app/user/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  // Admin login check
  if (email.toLowerCase() === 'admin@inversionesfinance.com' && password === 'admin123') {
    return res.json({
      success: true,
      role: 'admin',
      user: { name: 'Administrator', email: 'admin@inversionesfinance.com' },
      redirect: '/app/admin'
    });
  }

  const store = readStore();
  const user = store.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);

  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  if (user.status === 'Suspended') {
    return res.status(403).json({ success: false, message: 'Your account has been suspended. Please contact customer support.' });
  }

  return res.json({
    success: true,
    role: 'user',
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      phone: user.phone,
      balance: user.balance,
      interest_balance: user.interest_balance
    },
    redirect: '/app/user/dashboard'
  });
});

// GET /api/admin/data (Returns all users, requests, transactions)
app.get('/api/admin/data', (req, res) => {
  const store = readStore();
  res.json(store);
});

// POST /api/admin/users (Create user manually)
app.post('/api/admin/users', (req, res) => {
  const { name, email, username, phone, password, balance, interest_balance, status } = req.body;
  if (!name || !email || !username || !phone || !password) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  const store = readStore();
  if (store.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Email is already registered.' });
  }

  const newUser = {
    id: 'u_' + Date.now(),
    name,
    email,
    username,
    phone,
    password,
    balance: parseFloat(balance) || 0.0,
    interest_balance: parseFloat(interest_balance) || 0.0,
    status: status || 'Active',
    created_at: new Date().toISOString()
  };

  store.users.push(newUser);
  writeStore(store);
  res.json({ success: true, message: 'User created successfully.', user: newUser });
});

// PUT /api/admin/users/:id (Update user details)
app.put('/api/admin/users/:id', (req, res) => {
  const { id } = req.params;
  const { name, email, username, phone, status, balance, interest_balance } = req.body;

  const store = readStore();
  const index = store.users.findIndex(u => u.id === id);

  if (index === -1) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  const user = store.users[index];
  user.name = name || user.name;
  user.email = email || user.email;
  user.username = username || user.username;
  user.phone = phone || user.phone;
  user.status = status || user.status;
  if (balance !== undefined) user.balance = parseFloat(balance) || 0.0;
  if (interest_balance !== undefined) user.interest_balance = parseFloat(interest_balance) || 0.0;

  writeStore(store);
  res.json({ success: true, message: 'User updated successfully.', user });
});

// DELETE /api/admin/users/:id (Delete user)
app.delete('/api/admin/users/:id', (req, res) => {
  const { id } = req.params;
  const store = readStore();
  const initialCount = store.users.length;
  store.users = store.users.filter(u => u.id !== id);

  if (store.users.length === initialCount) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  writeStore(store);
  res.json({ success: true, message: 'User deleted successfully.' });
});

// POST /api/admin/requests/:id/approve (Approve signup request)
app.post('/api/admin/requests/:id/approve', (req, res) => {
  const { id } = req.params;
  const store = readStore();
  const reqIndex = store.signup_requests.findIndex(r => r.id === id);

  if (reqIndex === -1) {
    return res.status(404).json({ success: false, message: 'Signup request not found.' });
  }

  const request = store.signup_requests[reqIndex];

  // Check if email already used
  if (store.users.some(u => u.email.toLowerCase() === request.email.toLowerCase())) {
    store.signup_requests.splice(reqIndex, 1);
    writeStore(store);
    return res.status(400).json({ success: false, message: 'A user with this email already exists. Request removed.' });
  }

  const newUser = {
    id: 'u_' + Date.now(),
    name: request.name,
    email: request.email,
    username: request.username,
    phone: request.phone,
    password: request.password,
    balance: 0.00,
    interest_balance: 0.00,
    status: 'Active',
    created_at: new Date().toISOString()
  };

  store.users.push(newUser);
  store.signup_requests.splice(reqIndex, 1);
  writeStore(store);

  res.json({ success: true, message: 'Signup request approved! User created successfully.', user: newUser });
});

// POST /api/admin/requests/:id/reject (Reject/Delete signup request)
app.post('/api/admin/requests/:id/reject', (req, res) => {
  const { id } = req.params;
  const store = readStore();
  const initialLength = store.signup_requests.length;
  store.signup_requests = store.signup_requests.filter(r => r.id !== id);

  if (store.signup_requests.length === initialLength) {
    return res.status(404).json({ success: false, message: 'Signup request not found.' });
  }

  writeStore(store);
  res.json({ success: true, message: 'Signup request rejected and removed.' });
});

// GET /api/user/profile/:id (Fetch updated user data for dashboard)
app.get('/api/user/profile/:id', (req, res) => {
  const { id } = req.params;
  const store = readStore();
  const user = store.users.find(u => u.id === id);

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  if (user.status === 'Suspended') {
    return res.status(403).json({ success: false, message: 'Your account has been suspended.' });
  }

  // Get user's transactions
  const userTx = store.transactions.filter(t => t.user_id === id);

  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      phone: user.phone,
      balance: user.balance,
      interest_balance: user.interest_balance,
      status: user.status
    },
    transactions: userTx
  });
});

// Serve static assets from the root directory
app.use(express.static(__dirname));

// 404 Fallback
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
