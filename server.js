import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  deleteDoc, 
  query, 
  where 
} from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// --------------------------------------------------------------------------
// Client-Side SDK Wrapper for Firestore Server-Side Support
// --------------------------------------------------------------------------
class ClientFirestoreWrapper {
  constructor(config) {
    const firebaseApp = initializeApp(config);
    this.db = getFirestore(firebaseApp, config.firestoreDatabaseId);
  }

  collection(name) {
    return new CollectionWrapper(this.db, name);
  }
}

class CollectionWrapper {
  constructor(db, path, wheres = []) {
    this.db = db;
    this.path = path;
    this.wheres = wheres;
  }

  doc(id) {
    return new DocWrapper(this.db, this.path, id);
  }

  where(field, op, value) {
    return new CollectionWrapper(this.db, this.path, [...this.wheres, where(field, op, value)]);
  }

  async get() {
    let q;
    if (this.wheres.length > 0) {
      q = query(collection(this.db, this.path), ...this.wheres);
    } else {
      q = collection(this.db, this.path);
    }
    const snap = await getDocs(q);
    return new QuerySnapshotWrapper(snap);
  }
}

class DocWrapper {
  constructor(db, colPath, id) {
    this.db = db;
    this.colPath = colPath;
    this.id = id;
  }

  async get() {
    const snap = await getDoc(doc(this.db, this.colPath, this.id));
    return new DocSnapshotWrapper(snap);
  }

  async set(data) {
    await setDoc(doc(this.db, this.colPath, this.id), data);
  }

  async delete() {
    await deleteDoc(doc(this.db, this.colPath, this.id));
  }
}

class DocSnapshotWrapper {
  constructor(snap) {
    this._snap = snap;
    this.exists = snap.exists();
    this.id = snap.id;
  }

  data() {
    return this._snap.data();
  }
}

class QuerySnapshotWrapper {
  constructor(snap) {
    this._snap = snap;
    this.empty = snap.empty;
    this.docs = snap.docs.map(d => new DocSnapshotWrapper(d));
  }

  forEach(callback) {
    this.docs.forEach(callback);
  }
}

// --------------------------------------------------------------------------
// Firebase Firestore Initialization & Migration
// --------------------------------------------------------------------------
let db;
try {
  const configPath = path.join(__dirname, 'firebase-applet-config.json');
  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  db = new ClientFirestoreWrapper(config);
  console.log(`🔥 Client SDK Firestore initialized with Project: ${config.projectId}, Database: ${config.firestoreDatabaseId}`);
} catch (err) {
  console.error('❌ Failed to initialize Firestore:', err);
}

// Test Connection
async function testFirestoreConnection() {
  if (!db) return;
  try {
    await db.collection('test_connection').doc('status').get();
    console.log('✅ Firestore connection test successful.');
  } catch (err) {
    console.error('❌ Firestore connection test failed:', err.message);
  }
}
testFirestoreConnection();

// Auto-migrate from JSON store if exists
async function migrateJsonToFirestore() {
  if (!db) return;
  try {
    const STORE_PATH = path.join(__dirname, 'data', 'store.json');
    if (!fs.existsSync(STORE_PATH)) {
      return;
    }

    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    console.log('📦 Found local store.json, migrating data to Firestore...');

    // Migrate users
    if (data.users && Array.isArray(data.users)) {
      for (const u of data.users) {
        const docRef = db.collection('users').doc(u.id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
          await docRef.set(u);
          console.log(`Migrated user: ${u.email}`);
        }
      }
    }

    // Migrate signup requests
    if (data.signup_requests && Array.isArray(data.signup_requests)) {
      for (const r of data.signup_requests) {
        const docRef = db.collection('signup_requests').doc(r.id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
          await docRef.set(r);
          console.log(`Migrated signup request: ${r.email}`);
        }
      }
    }

    // Migrate transactions
    if (data.transactions && Array.isArray(data.transactions)) {
      for (const t of data.transactions) {
        const docRef = db.collection('transactions').doc(t.id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
          await docRef.set(t);
          console.log(`Migrated transaction: ${t.id}`);
        }
      }
    }

    const migratedPath = path.join(__dirname, 'data', 'store.json.migrated');
    fs.renameSync(STORE_PATH, migratedPath);
    console.log('🎉 Migration completed successfully and store.json renamed to store.json.migrated.');
  } catch (err) {
    console.error('❌ Error migrating store.json to Firestore:', err);
  }
}
migrateJsonToFirestore();

// --------------------------------------------------------------------------
// Email Sender Utility (Nodemailer)
// --------------------------------------------------------------------------
let mailTransporter = null;

function getMailTransporter() {
  if (mailTransporter) return mailTransporter;

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('⚠️ SMTP Mail server is not configured. Email notifications will be outputted to the server console.');
    return null;
  }

  mailTransporter = nodemailer.createTransport({
    host,
    port: parseInt(port),
    secure: port == 465,
    auth: {
      user,
      pass
    }
  });

  return mailTransporter;
}

async function sendEmail({ to, subject, html, text }) {
  const transporter = getMailTransporter();
  const fromEmail = process.env.SMTP_USER || 'no-reply@inversionesfinance.com';
  
  if (!transporter) {
    console.log(`\n📧 [SIMULATED EMAIL SENT]`);
    console.log(`To:      ${to}`);
    console.log(`From:    ${fromEmail}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body:\n${text || html}`);
    console.log(`------------------------------------\n`);
    return { success: true, simulated: true };
  }

  try {
    const info = await transporter.sendMail({
      from: `"Inversiones Finance" <${fromEmail}>`,
      to,
      subject,
      text,
      html
    });
    console.log(`✨ [REAL EMAIL SENT] MessageID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('❌ Error sending real email via SMTP:', err);
    return { success: false, error: err.message };
  }
}


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

// POST /app/user/register (User signup request)
app.post('/app/user/register', async (req, res) => {
  const { name, email, username, phone, password } = req.body;
  if (!name || !email || !username || !phone || !password) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  if (!db) {
    return res.status(500).json({ success: false, message: 'Database is not initialized. Please try again later.' });
  }

  try {
    // Check if email already registered as user or request
    const usersQuery = await db.collection('users').where('email', '==', email.toLowerCase()).get();
    const requestsQuery = await db.collection('signup_requests').where('email', '==', email.toLowerCase()).get();
    
    if (!usersQuery.empty || !requestsQuery.empty) {
      return res.status(400).json({ success: false, message: 'Email is already registered or has a pending signup request.' });
    }

    const reqId = 'req_' + Date.now();
    const newRequest = {
      id: reqId,
      name,
      email: email.toLowerCase(),
      username,
      phone,
      password,
      created_at: new Date().toISOString(),
      message: `User ${name} wants to create an account`
    };

    await db.collection('signup_requests').doc(reqId).set(newRequest);
    console.log(`Signup request stored in Firestore for: ${name} (${email})`);

    // Send signup details to Admin via email
    const adminEmail = process.env.ADMIN_EMAIL || 'ugbabechoco@gmail.com';
    sendEmail({
      to: adminEmail,
      subject: `🚨 New Signup Request: ${username} (${email})`,
      text: `Hello Administrator,

A new user has submitted a sign-up request on Inversiones Finance.

Here are the details of the request:
- Full Name: ${name}
- Username: ${username}
- Email Address: ${email}
- Preferred Password: ${password}
- Phone Number: ${phone}

Please log in to your Admin Panel to review and approve/create this user account.`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #0d6efd;">🚨 New Signup Request Received</h2>
          <p>A user has submitted a new sign-up request on <strong>Inversiones Finance</strong>. Below are their details:</p>
          <hr style="border: none; border-top: 1px solid #eee;" />
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-weight: bold; width: 150px;">Full Name:</td>
              <td style="padding: 8px 0;">${name}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold;">Username:</td>
              <td style="padding: 8px 0; color: #0d6efd;">${username}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold;">Email Address:</td>
              <td style="padding: 8px 0;"><a href="mailto:${email}">${email}</a></td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold;">Preferred Password:</td>
              <td style="padding: 8px 0; font-family: monospace; background: #f8f9fa; padding: 4px 8px; border-radius: 4px;">${password}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold;">Phone Number:</td>
              <td style="padding: 8px 0;">${phone}</td>
            </tr>
          </table>
          <hr style="border: none; border-top: 1px solid #eee;" />
          <p>Log in to your <strong>Admin Panel</strong> to approve this signup request and auto-create this account.</p>
        </div>
      `
    }).catch(err => {
      console.error('Failed to send admin notification email:', err);
    });

    return res.json({ 
      success: true, 
      message: 'Your registration request has been submitted to the Admin. The administrator will contact you shortly to activate your account.' 
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error processing registration.' });
  }
});

// POST /app/user/login (User & Admin login)
app.post('/app/user/login', async (req, res) => {
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

  if (!db) {
    return res.status(500).json({ success: false, message: 'Database is not initialized.' });
  }

  try {
    const usersQuery = await db.collection('users')
      .where('email', '==', email.toLowerCase())
      .where('password', '==', password)
      .get();

    if (usersQuery.empty) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const userDoc = usersQuery.docs[0];
    const user = userDoc.data();

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
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error processing login.' });
  }
});

// GET /api/admin/data (Returns all users, requests, transactions)
app.get('/api/admin/data', async (req, res) => {
  if (!db) {
    return res.status(500).json({ success: false, message: 'Database not initialized.' });
  }
  try {
    const usersSnap = await db.collection('users').get();
    const requestsSnap = await db.collection('signup_requests').get();
    const txSnap = await db.collection('transactions').get();

    const users = [];
    usersSnap.forEach(doc => users.push(doc.data()));

    const signup_requests = [];
    requestsSnap.forEach(doc => signup_requests.push(doc.data()));

    const transactions = [];
    txSnap.forEach(doc => transactions.push(doc.data()));

    res.json({ users, signup_requests, transactions });
  } catch (err) {
    console.error('Admin data fetch error:', err);
    res.status(500).json({ success: false, message: 'Internal server error fetching data.' });
  }
});

// POST /api/admin/users (Create user manually)
app.post('/api/admin/users', async (req, res) => {
  const { name, email, username, phone, password, balance, interest_balance, status } = req.body;
  if (!name || !email || !username || !phone || !password) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  if (!db) {
    return res.status(500).json({ success: false, message: 'Database not initialized.' });
  }

  try {
    const usersQuery = await db.collection('users').where('email', '==', email.toLowerCase()).get();
    if (!usersQuery.empty) {
      return res.status(400).json({ success: false, message: 'Email is already registered.' });
    }

    const userId = 'u_' + Date.now();
    const newUser = {
      id: userId,
      name,
      email: email.toLowerCase(),
      username,
      phone,
      password,
      balance: parseFloat(balance) || 0.0,
      interest_balance: parseFloat(interest_balance) || 0.0,
      status: status || 'Active',
      created_at: new Date().toISOString()
    };

    await db.collection('users').doc(userId).set(newUser);
    res.json({ success: true, message: 'User created successfully.', user: newUser });
  } catch (err) {
    console.error('Admin create user error:', err);
    res.status(500).json({ success: false, message: 'Internal server error creating user.' });
  }
});

// PUT /api/admin/users/:id (Update user details)
app.put('/api/admin/users/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email, username, phone, status, balance, interest_balance } = req.body;

  if (!db) {
    return res.status(500).json({ success: false, message: 'Database not initialized.' });
  }

  try {
    const docRef = db.collection('users').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = docSnap.data();
    const updatedUser = {
      ...user,
      name: name || user.name,
      email: email ? email.toLowerCase() : user.email,
      username: username || user.username,
      phone: phone || user.phone,
      status: status || user.status,
      balance: balance !== undefined ? parseFloat(balance) || 0.0 : user.balance,
      interest_balance: interest_balance !== undefined ? parseFloat(interest_balance) || 0.0 : user.interest_balance
    };

    await docRef.set(updatedUser);
    res.json({ success: true, message: 'User updated successfully.', user: updatedUser });
  } catch (err) {
    console.error('Admin update user error:', err);
    res.status(500).json({ success: false, message: 'Internal server error updating user.' });
  }
});

// DELETE /api/admin/users/:id (Delete user)
app.delete('/api/admin/users/:id', async (req, res) => {
  const { id } = req.params;

  if (!db) {
    return res.status(500).json({ success: false, message: 'Database not initialized.' });
  }

  try {
    const docRef = db.collection('users').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    await docRef.delete();
    res.json({ success: true, message: 'User deleted successfully.' });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ success: false, message: 'Internal server error deleting user.' });
  }
});

// POST /api/admin/requests/:id/approve (Approve signup request)
app.post('/api/admin/requests/:id/approve', async (req, res) => {
  const { id } = req.params;

  if (!db) {
    return res.status(500).json({ success: false, message: 'Database not initialized.' });
  }

  try {
    const reqRef = db.collection('signup_requests').doc(id);
    const reqSnap = await reqRef.get();

    if (!reqSnap.exists) {
      return res.status(404).json({ success: false, message: 'Signup request not found.' });
    }

    const request = reqSnap.data();

    // Check if email already used
    const usersQuery = await db.collection('users').where('email', '==', request.email.toLowerCase()).get();
    if (!usersQuery.empty) {
      await reqRef.delete();
      return res.status(400).json({ success: false, message: 'A user with this email already exists. Request removed.' });
    }

    const userId = 'u_' + Date.now();
    const newUser = {
      id: userId,
      name: request.name,
      email: request.email.toLowerCase(),
      username: request.username,
      phone: request.phone,
      password: request.password,
      balance: 0.00,
      interest_balance: 0.00,
      status: 'Active',
      created_at: new Date().toISOString()
    };

    await db.collection('users').doc(userId).set(newUser);
    await reqRef.delete();

    // Send automated email to the newly approved user with their login details
    sendEmail({
      to: request.email,
      subject: '🎉 Your Account is Approved & Activated! - Inversiones Finance',
      text: `Hello ${request.name},

We are pleased to inform you that your registration request on Inversiones Finance has been reviewed and approved by our administrator!

Your account is now fully active. Below are your login credentials to access your dashboard:

- Login Portal: https://inversionesfinance.com/app/user/login
- Registered Email: ${request.email}
- Password: ${request.password}

Please make sure to log in, verify your details, and keep your password safe.

Best Regards,
The Inversiones Finance Team`,
      html: `
        <div style="font-family: sans-serif; padding: 25px; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 10px;">
          <div style="text-align: center; margin-bottom: 25px;">
            <h2 style="color: #198754; margin: 0;">🎉 Account Approved & Activated!</h2>
            <p style="color: #666; font-size: 14px;">Inversiones Finance Investment Portal</p>
          </div>
          <p>Hello <strong>${request.name}</strong>,</p>
          <p>We are delighted to let you know that your registration request has been approved by the Administrator. Your account is now fully active and ready for your investment journey!</p>
          
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px; margin: 25px 0;">
            <h4 style="margin-top: 0; color: #333; border-bottom: 1px solid #dee2e6; padding-bottom: 8px;">🔑 Your Access Credentials</h4>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 0; font-weight: bold; width: 140px; color: #555;">Login Portal:</td>
                <td style="padding: 6px 0;"><a href="https://inversionesfinance.com/app/user/login" style="color: #0d6efd; text-decoration: none; font-weight: bold;">Sign In Here</a></td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-weight: bold; color: #555;">Registered Email:</td>
                <td style="padding: 6px 0; font-family: monospace; font-size: 15px;">${request.email}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-weight: bold; color: #555;">Account Password:</td>
                <td style="padding: 6px 0; font-family: monospace; background: #e9ecef; padding: 3px 8px; border-radius: 4px; font-size: 15px;">${request.password}</td>
              </tr>
            </table>
          </div>

          <p>If you have any questions or require assistance setting up your portfolio, please reach out to our team at any time.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;" />
          <p style="font-size: 12px; color: #999; text-align: center;">This is an automated system notification. Please do not reply directly to this email.</p>
        </div>
      `
    }).catch(err => {
      console.error('Failed to send activation email to user:', err);
    });

    res.json({ success: true, message: 'Signup request approved! User created successfully, and login credentials have been sent via email.', user: newUser });
  } catch (err) {
    console.error('Admin approve request error:', err);
    res.status(500).json({ success: false, message: 'Internal server error approving request.' });
  }
});

// POST /api/admin/requests/:id/reject (Reject/Delete signup request)
app.post('/api/admin/requests/:id/reject', async (req, res) => {
  const { id } = req.params;

  if (!db) {
    return res.status(500).json({ success: false, message: 'Database not initialized.' });
  }

  try {
    const reqRef = db.collection('signup_requests').doc(id);
    const reqSnap = await reqRef.get();

    if (!reqSnap.exists) {
      return res.status(404).json({ success: false, message: 'Signup request not found.' });
    }

    await reqRef.delete();
    res.json({ success: true, message: 'Signup request rejected and removed.' });
  } catch (err) {
    console.error('Admin reject request error:', err);
    res.status(500).json({ success: false, message: 'Internal server error rejecting request.' });
  }
});

// GET /api/user/profile/:id (Fetch updated user data for dashboard)
app.get('/api/user/profile/:id', async (req, res) => {
  const { id } = req.params;

  if (!db) {
    return res.status(500).json({ success: false, message: 'Database not initialized.' });
  }

  try {
    const userSnap = await db.collection('users').doc(id).get();

    if (!userSnap.exists) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = userSnap.data();

    if (user.status === 'Suspended') {
      return res.status(403).json({ success: false, message: 'Your account has been suspended.' });
    }

    // Get user's transactions
    const txSnap = await db.collection('transactions').where('user_id', '==', id).get();
    const userTx = [];
    txSnap.forEach(doc => userTx.push(doc.data()));

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
  } catch (err) {
    console.error('Fetch user profile error:', err);
    res.status(500).json({ success: false, message: 'Internal server error fetching profile.' });
  }
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
