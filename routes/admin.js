const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Message = require('../models/Message');

// Admin dashboard
router.get('/', async (req, res) => {
  try {
    // Get all customers with their last message and unread count
    const customers = await User.aggregate([
      { $match: { role: 'customer' } },
      {
        $lookup: {
          from: 'messages',
          let: { customerId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$senderId', '$$customerId'] },
                    { $eq: ['$receiverId', '$$customerId'] }
                  ]
                },
                isDeleted: false
              }
            },
            { $sort: { timestamp: -1 } },
            { $limit: 1 },
            {
              $lookup: {
                from: 'users',
                localField: 'senderId',
                foreignField: '_id',
                as: 'sender'
              }
            },
            { $unwind: '$sender' },
            {
              $project: {
                content: 1,
                timestamp: 1,
                isRead: 1,
                senderId: 1,
                'sender.username': 1
              }
            }
          ],
          as: 'lastMessage'
        }
      },
      {
        $lookup: {
          from: 'messages',
          let: { customerId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$receiverId', '$$customerId'] },
                    { $eq: ['$isRead', false] },
                    { $eq: ['$isDeleted', false] }
                  ]
                }
              }
            },
            { $count: 'count' }
          ],
          as: 'unreadMessages'
        }
      },
      {
        $addFields: {
          lastMessage: { $arrayElemAt: ['$lastMessage', 0] },
          unreadCount: { $arrayElemAt: ['$unreadMessages.count', 0] }
        }
      },
      {
        $project: {
          username: 1,
          createdAt: 1,
          lastMessage: 1,
          unreadCount: { $ifNull: ['$unreadCount', 0] }
        }
      },
      { $sort: { 'lastMessage.timestamp': -1, 'createdAt': -1 } }
    ]);

    res.render('admin', { customers });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).render('error', { message: 'Internal Server Error' });
  }
});

// Admin chat with specific customer
router.get('/chat/:customerId', async (req, res) => {
  try {
    const customerId = req.params.customerId;
    const customer = await User.findById(customerId);
    
    if (!customer) {
      return res.status(404).render('error', { message: 'Customer not found' });
    }
    
    if (customer.role !== 'customer') {
      return res.status(400).render('error', { message: 'Invalid user' });
    }
    
    // Find admin user
    const admin = await User.findOne({ role: 'admin' });
    
    if (!admin) {
      return res.status(404).render('error', { message: 'Admin not found' });
    }
    
    // Room ID is a combination of customer ID and admin ID
    const roomId = `${customerId}-${admin._id}`;
    
    // Mark all messages from this customer as read
    await Message.updateMany(
      { 
        senderId: customerId,
        receiverId: admin._id,
        isRead: false 
      },
      { isRead: true }
    );
    
    res.render('chat', { 
      customer, 
      admin: { _id: admin._id, username: admin.username },
      roomId,
      isAdmin: true
    });
  } catch (error) {
    console.error('Admin chat error:', error);
    res.status(500).render('error', { message: 'Internal Server Error' });
  }
});

// Delete user and their messages
router.post('/delete-user/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    if (user.role === 'admin') {
      return res.status(400).json({ success: false, message: 'Cannot delete admin user' });
    }
    
    // Delete user's messages
    await Message.deleteMany({
      $or: [
        { senderId: userId },
        { receiverId: userId }
      ]
    });
    
    // Delete user
    await User.findByIdAndDelete(userId);
    
    res.json({ success: true, message: 'User and their messages deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// Mark messages as read
router.post('/mark-as-read/:customerId', async (req, res) => {
  try {
    const customerId = req.params.customerId;
    const admin = await User.findOne({ role: 'admin' });
    
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }
    
    await Message.updateMany(
      { 
        senderId: customerId,
        receiverId: admin._id,
        isRead: false 
      },
      { isRead: true }
    );
    
    res.json({ success: true, message: 'Messages marked as read' });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

module.exports = router;