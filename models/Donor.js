const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema({
  amount: Number,
  date: String
});

const donorSchema = new mongoose.Schema({
  name: String,
  address: String,
  city: String,
  donations: [donationSchema]
});

module.exports = mongoose.model('Donor', donorSchema);
