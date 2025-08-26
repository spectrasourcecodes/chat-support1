const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Home page - customer login
router.get('/', (req, res) => {
  res.render('index');
});

// Handle customer login
router.post('/login', async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username || username.trim() === '') {
      return res.render('index', { error: 'Please enter a valid username' });
    }
    
    // Check if user exists
    let user = await User.findOne({ username });
    
    // If user doesn't exist, create a new customer
    if (!user) {
      user = new User({ username, role: 'customer' });
      await user.save();
    } else if (user.role === 'admin') {
      // If admin is trying to login from customer page, redirect to admin
      return res.redirect('/admin');
    }
    
    // Redirect to chat room
    res.redirect(`/chat/${user._id}`);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).render('index', { error: 'Internal Server Error' });
  }
});

// Customer chat page
router.get('/chat/:customerId', async (req, res) => {
  try {
    const customerId = req.params.customerId;
    const customer = await User.findById(customerId);
    
    if (!customer) {
      return res.status(404).render('error', { message: 'Customer not found' });
    }
    
    if (customer.role !== 'customer') {
      return res.redirect('/admin');
    }
    
    // Find admin user
    const admin = await User.findOne({ role: 'admin' });
    
    if (!admin) {
      return res.status(404).render('error', { message: 'Admin not found. Please try again later.' });
    }
    
    // Room ID is a combination of customer ID and admin ID
    const roomId = `${customerId}-${admin._id}`;
    
    res.render('chat', { 
      customer, 
      admin, 
      roomId,
      isAdmin: false  // Add this line to fix the error
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).render('error', { message: 'Internal Server Error' });
  }
});

module.exports = router;