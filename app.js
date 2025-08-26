const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Configure Socket.IO for Vercel
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chat-app';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'image-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Import models
const User = require('./models/User');
const Message = require('./models/Message');
// Add this with your other route imports
const uploadRoutes = require('./routes/upload');
app.use('/api', uploadRoutes);

// Create admin user if it doesn't exist
async function createAdminUser() {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      const adminUser = new User({
        username: 'admin',
        role: 'admin'
      });
      await adminUser.save();
      console.log('Admin user created successfully');
    } else {
      console.log('Admin user already exists');
    }
  } catch (error) {
    console.error('Error creating admin user:', error);
  }
}

// Routes
app.use('/', require('./routes/index'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/upload'));

// Socket.io setup
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a room
  socket.on('join-room', async (data) => {
    socket.join(data.roomId);
    console.log(`User ${data.username} joined room ${data.roomId}`);
    
    // Send message history to the user
    try {
      const messages = await Message.find({ roomId: data.roomId, isDeleted: false })
        .sort({ timestamp: 1 })
        .populate('senderId', 'username');
      
      socket.emit('message-history', messages);
    } catch (error) {
      console.error('Error fetching message history:', error);
    }
  });

  // Handle new messages
socket.on('send-message', async (data) => {
  try {
    // Save message to database
    const message = new Message({
      senderId: data.senderId,
      receiverId: data.receiverId,
      content: data.content,
      timestamp: new Date(),
      roomId: data.roomId
    });
    
    await message.save();
    await message.populate('senderId', 'username');
    
    // Send message to all users in the room
    io.to(data.roomId).emit('receive-message', message);
    
    // If the receiver is admin, notify all admin clients to update their dashboard
    const receiver = await User.findById(data.receiverId);
    if (receiver && receiver.role === 'admin') {
      io.emit('admin-notification', { 
        customerId: data.senderId,
        hasUnread: true 
      });
    }
  } catch (error) {
    console.error('Error saving message:', error);
  }
});

// Handle image messages
socket.on('send-image', async (data) => {
  try {
    const message = new Message({
      senderId: data.senderId,
      receiverId: data.receiverId,
      content: 'Image',
      timestamp: new Date(),
      roomId: data.roomId,
      messageType: 'image',
      imageUrl: data.imageUrl
    });
    
    await message.save();
    await message.populate('senderId', 'username');
    
    // Send message to all users in the room
    io.to(data.roomId).emit('receive-message', message);
    
    // If the receiver is admin, notify all admin clients to update their dashboard
    const receiver = await User.findById(data.receiverId);
    if (receiver && receiver.role === 'admin') {
      io.emit('admin-notification', { 
        customerId: data.senderId,
        hasUnread: true 
      });
    }
  } catch (error) {
    console.error('Error saving image message:', error);
    socket.emit('error', { message: 'Error sending image' });
  }
});

  // Handle message editing
  socket.on('edit-message', async (data) => {
    try {
      const message = await Message.findById(data.messageId);
      
      if (!message) {
        return socket.emit('error', { message: 'Message not found' });
      }
      
      // Check if user is the sender
      if (message.senderId.toString() !== data.userId) {
        return socket.emit('error', { message: 'Unauthorized to edit this message' });
      }
      
      // Check if message is already read by recipient
      if (message.isRead && !data.isAdmin) {
        return socket.emit('error', { message: 'Cannot edit message that has been read' });
      }
      
      // Update message content
      message.content = data.newContent;
      message.isEdited = true;
      await message.save();
      
      // Notify all users in the room
      io.to(message.roomId).emit('message-edited', {
        messageId: message._id,
        newContent: message.content,
        isEdited: true
      });
    } catch (error) {
      console.error('Error editing message:', error);
      socket.emit('error', { message: 'Error editing message' });
    }
  });

  // Handle message deletion
  socket.on('delete-message', async (data) => {
    try {
      const message = await Message.findById(data.messageId);
      
      if (!message) {
        return socket.emit('error', { message: 'Message not found' });
      }
      
      // Check if user is the sender or admin
      const isSender = message.senderId.toString() === data.userId;
      const isAdminUser = data.isAdmin;
      
      if (!isSender && !isAdminUser) {
        return socket.emit('error', { message: 'Unauthorized to delete this message' });
      }
      
      // For non-admin users, check if message is already read
      if (isSender && !isAdminUser && message.isRead) {
        return socket.emit('error', { message: 'Cannot delete message that has been read' });
      }
      
      // For admin, check if message is read by customer
      if (isAdminUser && message.isRead) {
        return socket.emit('error', { message: 'Cannot delete message that has been read by customer' });
      }
      
      // Soft delete
      message.isDeleted = true;
      await message.save();
      
      // Notify all users in the room
      io.to(message.roomId).emit('message-deleted', {
        messageId: message._id
      });
    } catch (error) {
      console.error('Error deleting message:', error);
      socket.emit('error', { message: 'Error deleting message' });
    }
  });

  // Handle message read status
  socket.on('mark-as-read', async (data) => {
    try {
      await Message.updateMany(
        { 
          roomId: data.roomId, 
          receiverId: data.userId,
          isRead: false 
        },
        { isRead: true }
      );
      
      // Notify sender that messages have been read
      socket.to(data.roomId).emit('messages-read', {
        readerId: data.userId
      });
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  });

  // Handle image messages
  socket.on('send-image', async (data) => {
    try {
      const message = new Message({
        senderId: data.senderId,
        receiverId: data.receiverId,
        content: 'Image',
        timestamp: new Date(),
        roomId: data.roomId,
        messageType: 'image',
        imageUrl: data.imageUrl
      });
      
      await message.save();
      await message.populate('senderId', 'username');
      
      // Send message to all users in the room
      io.to(data.roomId).emit('receive-message', message);
    } catch (error) {
      console.error('Error saving image message:', error);
      socket.emit('error', { message: 'Error sending image' });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Vercel requires module.exports for serverless functions
module.exports = app;

// But we also need to start the server when running locally
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  
  // Create admin user when server starts
  server.listen(PORT, async () => {
    await createAdminUser();
    console.log(`Server running on port ${PORT}`);
  });
}