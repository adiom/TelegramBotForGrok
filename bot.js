require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Check for the presence of the token
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('ERROR: Bot token not found! Make sure the .env file exists and contains TELEGRAM_BOT_TOKEN');
    process.exit(1);
}

// Replace 'your_bot_token' with the token from your .env file
const token = process.env.TELEGRAM_BOT_TOKEN;

// Initialize the bot with additional options
const bot = new TelegramBot(token, {
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

// API endpoint and key from .env
const GROK_API_ENDPOINT = process.env.GROK_API_ENDPOINT || 'https://api.x.ai/v1/chat/completions';
const GROK_API_KEY = process.env.GROK_API_KEY;

// Object to store chat context for each user
const chatContexts = {};

// Function to create or get the log file name
const getLogFileName = (chatId) => {
    const logsDir = path.join(__dirname, 'chat_logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir);
    }
    return path.join(logsDir, `chat_${chatId}.txt`);
};

// Function to log a message
const logMessage = (chatId, role, content) => {
    const logFileName = getLogFileName(chatId);
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${role.toUpperCase()}: ${content}\n`;

    fs.appendFile(logFileName, logEntry, (err) => {
        if (err) {
            console.error('Error writing to log:', err);
        }
    });
};

// Function to escape special characters for MarkdownV2
function escapeMarkdown(text) {
    return text.replace(/([_*\[\]\(\)~`>\#\+\-\=\|\{\}\.\!])/g, '\\$1');
}

// Function to send messages
async function sendMessage(chatId, text, options = {}) {
  try {
      await bot.sendMessage(chatId, text, options);
  } catch (error) {
      console.error('Error sending message:', error);
        if(error.response) {
           console.error('Telegram API error details:', error.response.body);
        }
  }
}

// Add states for users
const userStates = new Map();

// Create a keyboard with buttons
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            ['👁 View Context', '🎭 Change Role']
        ],
        resize_keyboard: true,
        one_time_keyboard: true // Add this option
    }
};

// Handler for the /start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    sendMessage(chatId, 'Welcome! I am a chat bot. Use the buttons or just send a message!', {
        reply_markup: mainKeyboard.reply_markup // Make sure to pass the keyboard correctly
    });
    // Initialize context for the user if it doesn't exist
    if (!chatContexts[chatId]) {
        chatContexts[chatId] = {
            messages: [
                {
                    "role": "system",
                    "content": "You are an English language expert, and I am learning it. I will send you my messages, if they are in English it means I translated them into English. And you comment on what is better to correct, if they are in Russian then translate into English and comment! the message needs to be used on Twitter, you can add emojis"
                }
            ]
        };
    }
});

// Function to display context
async function showContext(chatId) {
    if (!chatContexts[chatId] || !chatContexts[chatId].messages) {
        await sendMessage(chatId, 'Context is empty');
        return;
    }

    const contextSummary = chatContexts[chatId].messages
        .map((msg, index) => `${index}. ${msg.role}: ${
            typeof msg.content === 'string' 
                ? msg.content.substring(0, 100) + '...' 
                : 'Message with image'
        }`)
        .join('\n\n');

    await sendMessage(chatId, `Current chat context:\n\n${contextSummary}`);
}

// Function to change role
async function changeRole(chatId) {
    userStates.set(chatId, 'awaiting_role');
    await sendMessage(chatId, 'Please describe the new role:', {
        reply_markup: {
            force_reply: true
        }
    });
}

// Add a new function to handle photos
async function processPhoto(fileId) {
    try {
        const fileLink = await bot.getFileLink(fileId);
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data, 'binary');
        return imageBuffer.toString('base64');
    } catch (error) {
        console.error('Error downloading photo:', error);
        return null;
    }
}

// Storage for media groups
const mediaGroups = new Map();

// Function to clean up old media groups
const cleanupMediaGroups = () => {
    const now = Date.now();
    for (const [groupId, group] of mediaGroups.entries()) {
        if (now - group.timestamp > 5000) { // Delete groups older than 5 seconds
            mediaGroups.delete(groupId);
        }
    }
};

// Run cleanup every 10 seconds
setInterval(cleanupMediaGroups, 10000);

// Handler for all messages (text and photo)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    let text = msg.caption || msg.text;
    let photos = [];

    // Check user state
    if (userStates.get(chatId) === 'awaiting_role') {
        if (text) {
            // Clear old context and set new role
            chatContexts[chatId] = {
                messages: [
                    {
                        "role": "system",
                        "content": text
                    }
                ]
            };
            userStates.delete(chatId);
            await sendMessage(chatId, 'Role successfully changed! You can start chatting.', mainKeyboard);
            return;
        }
    }

    // Handle buttons
    if (text === '👁 View Context') {
        await showContext(chatId);
        return;
    }
    if (text === '🎭 Change Role') {
        await changeRole(chatId);
        return;
    }

    // Check if the message is part of a media group
    if (msg.media_group_id) {
        // Get or create a new group
        if (!mediaGroups.has(msg.media_group_id)) {
            mediaGroups.set(msg.media_group_id, {
                photos: [],
                text: '',
                timestamp: Date.now(),
                processing: false
            });
        }

        let group = mediaGroups.get(msg.media_group_id);

        // If the group is already being processed, skip
        if (group.processing) {
            return;
        }

        // Add photo to the group
        if (msg.photo) {
            const largestPhoto = msg.photo.reduce((prev, current) => 
                (prev.file_size > current.file_size ? prev : current)
            );
            const photoBase64 = await processPhoto(largestPhoto.file_id);
            if (photoBase64) group.photos.push(photoBase64);
        }

        // Update group text if available
        if (msg.caption) {
            group.text = msg.caption;
        }

        // Wait for other photos
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if the group is already being processed
        group = mediaGroups.get(msg.media_group_id);
        if (group && !group.processing) {
            group.processing = true;
            text = group.text;
            photos = [...group.photos];
            mediaGroups.delete(msg.media_group_id);
        } else {
            return;
        }
    }
    // Handle single photo
    else if (msg.photo) {
        const largestPhoto = msg.photo.reduce((prev, current) => 
            (prev.file_size > current.file_size ? prev : current)
        );
        const photoBase64 = await processPhoto(largestPhoto.file_id);
        if (photoBase64) photos.push(photoBase64);
    }

    // Ignore empty messages and commands
    if ((!text && photos.length === 0) || (text && text.startsWith('/'))) {
        return;
    }

    // Initialize context
    if (!chatContexts[chatId]) {
        chatContexts[chatId] = {
            messages: [
                {
                    "role": "system",
                    "content": "You are an English language expert, and I am learning it. I will send you my messages, if they are in English it means I translated them into English. And you comment on what is better to correct, if they are in Russian then translate into English and comment! the message needs to be used on Twitter, you can add emojis"
                }
            ]
        };
    }

    logMessage(chatId, 'user', text || `Photo (${photos.length} pcs)`);

    sendMessage(chatId, 'Requesting a response...');

    // Form the content of the message
    let userMessageContent;
    if (photos.length > 0) {
        userMessageContent = [
            { 
                type: "text", 
                text: text || 'Please describe these images' 
            },
            ...photos.map(photo => ({
                type: "image_url",
                image_url: {
                    url: `data:image/jpeg;base64,${photo}`
                }
            }))
        ];
    } else {
        userMessageContent = text;
    }

    let userMessage =  { role: 'user', content: userMessageContent };

    // Add user message to context
    if (chatContexts[chatId].messages.length === 1) {
        chatContexts[chatId].messages.push(userMessage);
    } else {
        chatContexts[chatId].messages.push(userMessage);
    }

    try {
        const response = await axios.post(GROK_API_ENDPOINT, {
            "messages": chatContexts[chatId].messages,
            "model": "grok-2-vision-1212",
            "stream": false,
            "temperature": 0
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROK_API_KEY}`
            }
        });

        // Check the response structure, expecting the response to be in `data.choices[0].message.content`
        if (response.data && response.data.choices && response.data.choices[0] && response.data.choices[0].message && response.data.choices[0].message.content) {
            let grokResponse = response.data.choices[0].message.content;
            // Escape special characters for MarkdownV2
            const escapedResponse = escapeMarkdown(grokResponse);
            await sendMessage(chatId, `${escapedResponse}`, { parse_mode: 'MarkdownV2' });

            logMessage(chatId, 'assistant', grokResponse);
            // Add Grok's response to context
            chatContexts[chatId].messages.push({ role: 'assistant', content: grokResponse });
            // Manage context size by removing old messages if needed
            if (chatContexts[chatId].messages.length > 10) { // Keep the last 10 messages
                chatContexts[chatId].messages.splice(1, 2); // remove old user + assistant
            }

        } else if (response.data && response.data.error) {
            sendMessage(chatId, `Grok API Error: ${response.data.error.message}`);
        } else {
            sendMessage(chatId, 'Failed to get a response. Check the response format.');
            console.error('Invalid response format from Grok API:', response.data);
        }

    } catch (error) {
        console.error('Error requesting Grok API:', error);
        if(error.response) {
            // If there is a response from the server, handle the error
            sendMessage(chatId, `An error occurred while contacting the Grok API. Status: ${error.response.status}, Message: ${JSON.stringify(error.response.data)}`);
            console.error('Grok API error details:', error.response.data);
        } else if (error.request) {
            // Request error
            sendMessage(chatId, 'An error occurred while sending a request to the Grok API.');
            console.error('Grok API request error:', error.message);
        } else {
            // Other errors
            sendMessage(chatId, 'An unknown error occurred while contacting the Grok API.');
            console.error('Grok API unknown error:', error.message);
        }
    }
});

// Polling error handler
bot.on('polling_error', (error) => {
    console.error('Error connecting to Telegram:', error.code);
    if (error.code === 'ETELEGRAM') {
        console.error('Check the correctness of the bot token and access to api.telegram.org');
        
        // Attempt to reconnect after 10 seconds
        setTimeout(() => {
            console.log('Attempting to reconnect...');
            bot.startPolling();
        }, 10000);
    }
});

// Successful launch handler
bot.on('polling_error', (error) => {
    if (error.code === 'ETIMEDOUT') {
        console.log('Connection timeout, reconnecting...');
        return;
    }
    console.error('Polling error:', error);
});

console.log('Bot is running and listening for messages!');