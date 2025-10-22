require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt'); // for password hashing

const app = express();
const PORT = process.env.PORT || 3000;

const Account = require('./models/Account');
const Donor = require('./models/Donor');

// === MongoDB connection ===
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// === Session ===
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret123',
  resave: false,
  saveUninitialized: false
}));

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
  }
  next(); // user is logged in, continue to the route
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'donation.html'));
});

// === Register (admin use only) ===
// === Register (admin only) ===
app.post('/api/register', async (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Only admin can create accounts.' });
  }

  const { role, username, password } = req.body;
  if (!username || !password || !role) {
    return res.json({ success: false, message: 'All fields are required.' });
  }

  const existing = await Account.findOne({ username });
  if (existing) {
    return res.json({ success: false, message: 'Username already exists.' });
  }

  const hashed = await bcrypt.hash(password, 10);
  const account = new Account({ role, username, password: hashed });
  await account.save();

  res.json({ success: true, message: 'Account created successfully.' });
});


// === Login ===
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const account = await Account.findOne({ username: username.trim() });
    if (!account || account.password !== password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    req.session.user = { id: account._id, username: account.username, role: account.role };
    res.json({ success: true, message: 'Login successful', user: req.session.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// === Logout ===
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, message: 'Logged out' });
  });
});

// === Protect all donor routes ===
app.use('/api/donors', requireLogin);
app.use('/api/donations', requireLogin);

// === Get all donors with total donations, filter & sort ===
app.get('/api/donors', async (req, res) => {
    try {
        const { name, city, minTotal, maxTotal, sortBy, sortOrder } = req.query;

        // Build filter
        const filter = {};
        if (name) filter.name = new RegExp(name, 'i'); // case-insensitive match
        if (city) filter.city = new RegExp(city, 'i');

        // Aggregation pipeline
        const donors = await Donor.aggregate([
            { $match: filter },
            { 
                $addFields: { 
                    totalDonation: { $sum: "$donations.amount" } 
                } 
            },
            // Filter by total donation if provided
            ...(minTotal || maxTotal ? [{
                $match: {
                    ...(minTotal ? { totalDonation: { $gte: parseFloat(minTotal) } } : {}),
                    ...(maxTotal ? { totalDonation: { $lte: parseFloat(maxTotal) } } : {})
                }
            }] : []),
            // Sorting
            ...(sortBy ? [{
                $sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 }
            }] : [])
        ]);

        res.json({ success: true, donors });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// === Delete donor ===
app.delete('/api/donors/:id', async (req, res) => {
  const donorId = req.params.id;

  try {
    const donor = await Donor.findByIdAndDelete(donorId);
    if (!donor) return res.status(404).json({ success: false, message: 'Donor not found' });
    res.json({ success: true, message: 'Donor removed' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// === Add / Edit / Delete specific donation ===
app.post('/api/donors/:id/donations', async (req, res) => {
  const donor = await Donor.findById(req.params.id);
  if (!donor) return res.status(404).json({ success: false, message: 'Donor not found' });

  donor.donations.push({ amount: req.body.amount, date: req.body.date });
  await donor.save();
  res.json({ success: true, donor });
});

app.put('/api/donors/:donorId/donations/:donationId', async (req, res) => {
  const { donorId, donationId } = req.params;
  const donor = await Donor.findById(donorId);
  if (!donor) return res.status(404).json({ success: false, message: 'Donor not found' });

  const donation = donor.donations.id(donationId);
  if (!donation) return res.status(404).json({ success: false, message: 'Donation not found' });

  donation.amount = req.body.amount ?? donation.amount;
  donation.date = req.body.date ?? donation.date;
  await donor.save();

  res.json({ success: true, donor });
});

app.delete('/api/donors/:donorId/donations/:donationId', async (req, res) => {
  const { donorId, donationId } = req.params;
  const donor = await Donor.findById(donorId);
  if (!donor) return res.status(404).json({ success: false, message: 'Donor not found' });

  donor.donations = donor.donations.filter(d => d._id.toString() !== donationId);
  await donor.save();

  res.json({ success: true, donor });
});

// Get all accounts
app.get('/api/accounts', async (req, res) => {
  const accounts = await Account.find().select('-password'); // hide password
  res.json(accounts);
});

// Update account
app.put('/api/accounts/:id', async (req, res) => {
  const { username, role } = req.body;
  await Account.findByIdAndUpdate(req.params.id, { username, role });
  res.json({ success: true, message: 'Account updated successfully.' });
});

// Delete account
app.delete('/api/accounts/:id', async (req, res) => {
  await Account.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: 'Account deleted successfully.' });
});


// === Start Server ===
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
