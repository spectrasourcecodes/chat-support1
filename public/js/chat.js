let socket;
let currentRoomId;
let currentUserId;
let isAdminUser;
let originalButtonText;

function initializeChat(customerId, adminId, roomId, isAdmin) {
    currentRoomId = roomId;
    currentUserId = isAdmin ? adminId : customerId; // Store current user's ID
    isAdminUser = isAdmin;
    
    // Store original button text
    const sendBtn = document.querySelector('#message-form button[type="submit"]');
    originalButtonText = sendBtn.innerHTML;
    
    // Connect to Socket.IO
    socket = io();
    
    // Join the room
    socket.emit('join-room', {
        username: isAdmin ? 'Admin' : 'Customer',
        roomId: roomId
    });
    
    // Handle message history
    socket.on('message-history', (messages) => {
        const messagesContainer = document.getElementById('messages');
        messagesContainer.innerHTML = '';
        
        messages.forEach(message => {
            if (!message.isDeleted) {
                addMessageToChat(message, customerId, adminId, isAdmin);
            }
        });
        
        // Scroll to bottom
        scrollToBottom();
        
        // Mark messages as read
        if (!isAdmin) {
            socket.emit('mark-as-read', {
                roomId: roomId,
                userId: customerId
            });
        }
    });
    
    // Handle new messages
    socket.on('receive-message', (message) => {
        addMessageToChat(message, customerId, adminId, isAdmin);
        scrollToBottom();
        
        // Mark as read if it's the recipient
        if ((isAdmin && message.senderId._id === customerId) || 
            (!isAdmin && message.senderId._id === adminId)) {
            socket.emit('mark-as-read', {
                roomId: roomId,
                userId: currentUserId
            });
        }
    });
    
    // Handle message edits
    socket.on('message-edited', (data) => {
        const messageElement = document.getElementById(`message-${data.messageId}`);
        if (messageElement) {
            const contentElement = messageElement.querySelector('.message-content');
            const textElement = contentElement.querySelector('div:first-child');
            if (textElement) {
                textElement.textContent = data.newContent;
            }
            
            const editedBadge = messageElement.querySelector('.edited-badge');
            if (data.isEdited && !editedBadge) {
                const timeElement = messageElement.querySelector('.message-time');
                timeElement.innerHTML += ' <span class="edited-badge">(edited)</span>';
            }
        }
    });
    
    // Handle message deletion
    socket.on('message-deleted', (data) => {
        const messageElement = document.getElementById(`message-${data.messageId}`);
        if (messageElement) {
            messageElement.remove();
        }
    });
    
    // Handle error messages
    socket.on('error', (data) => {
        showNotification(data.message, 'error');
    });
    
    // Handle message form submission
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const imageInput = document.getElementById('image-input');
    
    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const content = messageInput.value.trim();
        if (content) {
            // Send message
            socket.emit('send-message', {
                senderId: currentUserId,
                receiverId: isAdmin ? customerId : adminId,
                content: content,
                roomId: roomId
            });
            
            // Clear input
            messageInput.value = '';
        }
    });
    
    // Handle image upload
    imageInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // Check if file is an image
        if (!file.type.startsWith('image/')) {
            showNotification('Please select an image file (JPEG, PNG, GIF, etc.)', 'error');
            imageInput.value = '';
            return;
        }
        
        // Check file size (5MB limit)
        if (file.size > 5 * 1024 * 1024) {
            showNotification('Image must be less than 5MB', 'error');
            imageInput.value = '';
            return;
        }
        
        try {
            // Show loading indicator
            const sendBtn = document.querySelector('#message-form button[type="submit"]');
            sendBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Uploading...';
            sendBtn.disabled = true;
            
            // Create FormData for the upload
            const formData = new FormData();
            formData.append('image', file);
            
            // Upload the image
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            // Debugging: Log response details
            console.log('Upload response status:', response.status);
            const data = await response.json();
            console.log('Upload response data:', data);
            
            if (data.success) {
                // Send image message
                socket.emit('send-image', {
                    senderId: currentUserId,
                    receiverId: isAdmin ? customerId : adminId,
                    imageUrl: data.imageUrl,
                    roomId: roomId
                });
                showNotification('Image uploaded successfully!', 'success');
            } else {
                showNotification('Failed to upload image: ' + (data.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            console.error('Upload error:', error);
            showNotification('Failed to upload image. Please try again.', 'error');
        } finally {
            // Reset the file input and button
            imageInput.value = '';
            const sendBtn = document.querySelector('#message-form button[type="submit"]');
            sendBtn.innerHTML = originalButtonText;
            sendBtn.disabled = false;
        }
    });
    
    // Image modal functionality
    const modal = document.getElementById("image-modal");
    const modalImg = document.getElementById("modal-image");
    const captionText = document.getElementById("image-caption");
    const span = document.getElementsByClassName("close")[0];
    
    // When the user clicks on <span> (x), close the modal
    if (span) {
        span.onclick = function() {
            modal.style.display = "none";
        }
    }
    
    // When the user clicks anywhere outside of the modal, close it
    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    }
    
    // Add event delegation for image clicks
    const messagesContainer = document.getElementById('messages');
    if (messagesContainer) {
        messagesContainer.addEventListener('click', function(e) {
            if (e.target.classList.contains('chat-image')) {
                if (modal && modalImg && captionText) {
                    modal.style.display = "block";
                    modalImg.src = e.target.src;
                    captionText.innerHTML = e.target.alt;
                }
            }
        });
    }
}

function addMessageToChat(message, customerId, adminId, isAdminView) {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;
    
    const messageElement = document.createElement('div');
    
    // Determine message alignment - FIXED LOGIC
    // If we're in admin view, customer messages should be on left, admin on right
    // If we're in customer view, customer messages should be on right, admin on left
    const isCustomerMessage = message.senderId._id.toString() === customerId.toString();
    
    if (isAdminView) {
        // Admin view: customer messages on left, admin messages on right
        messageElement.className = `message ${isCustomerMessage ? 'customer' : 'admin'}`;
    } else {
        // Customer view: customer messages on right, admin messages on left
        messageElement.className = `message ${isCustomerMessage ? 'admin' : 'customer'}`;
    }
    
    messageElement.id = `message-${message._id}`;
    
    // Format timestamp
    const timestamp = new Date(message.timestamp).toLocaleTimeString();
    
    // Create message content based on type
    let messageContent = '';
    if (message.messageType === 'image') {
        messageContent = `<img src="${message.imageUrl}" alt="Shared image" class="chat-image">`;
    } else {
        messageContent = message.content;
    }
    
    // Create message HTML
    messageElement.innerHTML = `
        <div class="message-content">
            <div>${messageContent}</div>
            <div class="message-time">${timestamp} 
                ${message.isEdited ? '<span class="edited-badge">(edited)</span>' : ''}
                ${message.isRead ? '<span class="read-badge">✓ Read</span>' : ''}
            </div>
        </div>
        <div class="message-actions">
            ${((isAdminView && !isCustomerMessage) || (!isAdminView && isCustomerMessage)) && !message.isDeleted ? `
                <button class="btn btn-sm btn-outline-primary edit-btn" data-message-id="${message._id}">Edit</button>
                <button class="btn btn-sm btn-outline-danger delete-btn" data-message-id="${message._id}">Delete</button>
            ` : ''}
        </div>
    `;
    
    messagesContainer.appendChild(messageElement);
    
    // Add event listeners for edit and delete buttons
    // Users can only edit/delete their own messages
    const canEditDelete = ((isAdminView && !isCustomerMessage) || (!isAdminView && isCustomerMessage)) && !message.isDeleted;
    
    if (canEditDelete) {
        const editBtn = messageElement.querySelector('.edit-btn');
        const deleteBtn = messageElement.querySelector('.delete-btn');
        
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                editMessage(message._id, message.content);
            });
        }
        
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                deleteMessage(message._id);
            });
        }
    }
}

function editMessage(messageId, currentContent) {
    const newContent = prompt('Edit your message:', currentContent);
    if (newContent !== null && newContent.trim() !== '') {
        socket.emit('edit-message', {
            messageId: messageId,
            newContent: newContent.trim(),
            userId: currentUserId,
            isAdmin: isAdminUser
        });
    }
}

function deleteMessage(messageId) {
    if (confirm('Are you sure you want to delete this message?')) {
        socket.emit('delete-message', {
            messageId: messageId,
            userId: currentUserId,
            isAdmin: isAdminUser
        });
    }
}

function scrollToBottom() {
    const messagesContainer = document.getElementById('messages');
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

function showNotification(message, type) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `alert alert-${type === 'error' ? 'danger' : 'success'} alert-dismissible fade show`;
    notification.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // Add to page
    const container = document.querySelector('.container');
    if (container) {
        container.insertBefore(notification, container.firstChild);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }
}