const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = 'EAAGizoa2IFwBO63KQWgiZA1MdrnarUo8iEsOn1WS4hlpyoSRZCNS5ok9cEcxekdFVyH1ZAblGg7a5CrSYG967IxZB1jahELmoxNQq1b77PaYrTk9DTCPeq5Rm8JqGj6PBgJJ7ETmphqlA2fJixMKMEKZCQQ6QO9m64vsgqWGmsbNH6oFKybELCZCZBCSWmlNtcs3AZDZD';
const PAGE_ACCESS_TOKEN = 'EAAGizoa2IFwBO9h75MsQZCF0mIQUs2ZAOj6np59gElARZCYAEv8vQfQw1f0RekYOav7F25lwz7QaIdz2JRshoM2GAgiqvJZBPK10GziTs4HB6TU5a8ZCkDCMLqGJrGacgZCsZCA3ZCdCSsnVyGFZAZCC2HT7ZAfDmal8YZBOMHSwLI3bkZAQoZBSxwm8zwxZC1DN3lbSvFbywZDZD';

// Define a temporary storage for user conversations (this can be replaced with a database)
let userSessions = {};

// Temporary storage for OTP generation (to simulate OTP validation)
let otps = {};

// Webhook verification (Meta setup)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('Webhook verified!');
        res.status(200).send(challenge);
    } else {
        console.log('Webhook verification failed');
        res.sendStatus(403);
    }
});

// Webhook to handle incoming messages
app.post('/webhook', (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(entry => {
            if (entry.messaging && entry.messaging.length > 0) {
                const webhookEvent = entry.messaging[0];
                const senderId = webhookEvent.sender.id;

                console.log(webhookEvent);

                // Check if it's a postback (e.g., from a button click or quick reply)
                if (webhookEvent.postback) {
                    const postbackPayload = webhookEvent.postback.payload;
                    console.log('Postback received:', postbackPayload);

                    // Handle postback action
                    handlePostback(senderId, postbackPayload);
                } 
                // Check if it's a text message
                else if (webhookEvent.message && webhookEvent.message.text) {
                    handleUserMessage(senderId, webhookEvent.message.text);
                } else {
                    console.log('No text or postback message found');
                }
            } else {
                console.log('No messaging data found in entry:', entry);
            }
        });

        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});
function handlePostback(senderId, payload) {
    switch (payload) {
        case 'WELCOME_MESSAGE':
            userSessions[senderId] = { step: 'main_menu' };
            sendMainMenu(senderId);
            break;
        // Add other postback payload cases if necessary
        default:
            sendMessage(senderId, 'Sorry, I didn\'t understand that action.');
            break;
    }
}
// Function to send the main menu with Bill Inquiry option
function sendMainMenu(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            text: "Welcome! How can I assist you today?",
            quick_replies: [
                {
                    content_type: "text",
                    title: "BILL INQUIRY",
                    payload: "BILL_INQUIRY"
                },
                {
                    content_type: "text",
                    title: "APPLY FOR NEW CONNECTION",
                    payload: "NEW_CONNECTION"
                },
                {
                    content_type: "text",
                    title: "UPDATE CONTACT INFO",
                    payload: "UPDATE_CONTACT"
                },
                {
                    content_type: "text",
                    title: "Other",
                    payload: "OTHER"
                }
            ]
        }
    };

    axios.post(`https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData)
        .then(response => {
            console.log('Main Menu sent:', response.data);
        })
        .catch(error => {
            console.error('Error sending main menu:', error);
        });
}

// Function to send OTP delivery choice menu
function sendOTPChoiceMenu(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            text: "Where would you like to receive your OTP? Please select an option.",
            quick_replies: [
                {
                    content_type: "text",
                    title: "MOBILE NUMBER",
                    payload: "MOBILE_NUMBER"
                },
                {
                    content_type: "text",
                    title: "EMAIL ADDRESS",
                    payload: "EMAIL_ADDRESS"
                }
            ]
        }
    };

    axios.post(`https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData)
        .then(response => {
            console.log('OTP choice menu sent:', response.data);
        })
        .catch(error => {
            console.error('Error sending OTP choice menu:', error);
        });
}

// Function to send OTP message
function sendOTP(senderId, contactMethod) {
    const otp = Math.floor(100000 + Math.random() * 900000); // Generate a 6-digit OTP
    otps[senderId] = otp;

    const messageData = {
        recipient: { id: senderId },
        message: {
            text: `Your OTP is ${otp}. Please enter it to verify. OTP has been sent to your ${contactMethod}.`
        }
    };

    axios.post(`https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData)
        .then(response => {
            console.log('OTP sent:', response.data);
        })
        .catch(error => {
            console.error('Error sending OTP:', error);
        });
}

// Handle user responses based on the step they are in
function handleUserMessage(senderId, message) {
    switch (userSessions[senderId].step) {
        case 'main_menu':
            if (message === "BILL INQUIRY") {
                userSessions[senderId].step = 'ask_account';
                sendMessage(senderId, 'Please provide your 8-digit account number.');
            } else if (message === "UPDATE CONTACT INFO") {
                userSessions[senderId].step = 'ask_verification_method';
                sendOTPChoiceMenu(senderId);
            } else {
                sendMessage(senderId, 'Sorry, I can only assist with Bill Inquiry and Update Contact Info at the moment. Please choose one.');
            }
            break;
        case 'ask_account':
            // Validate the account number (replace with your actual verification logic)
            if (validateAccountNumber(message)) {
                userSessions[senderId].step = 'ask_otp_method';
                sendOTPChoiceMenu(senderId);
            } else {
                sendMessage(senderId, 'Sorry, the account number you provided is invalid. Please try again.');
            }
            break;
        case 'ask_otp_method':
            if (message === "MOBILE NUMBER" || message === "EMAIL ADDRESS") {
                userSessions[senderId].step = 'validate_otp';
                sendOTP(senderId, message.toLowerCase());
            } else {
                sendMessage(senderId, 'Invalid selection. Please choose from the options provided.');
            }
            break;
        // case 'send_otp':
        //     // Wait for OTP input
        //     userSessions[senderId].step = 'validate_otp';
        //     sendMessage(senderId, 'Please enter the OTP you received.');
        //     break;
        case 'validate_otp':
            if (message === otps[senderId].toString()) {
                userSessions[senderId].step = 'verified';
                sendMessage(senderId, 'Your Total Amount Due for the month of December 2024 is Php 1,234.00');
            } else {
                sendMessage(senderId, 'Invalid OTP. Please try again.');
            }
            break;
        default:
            sendMessage(senderId, 'I\'m not sure what you need. Please start again.');
            break;
    }
}

// Function to validate account number (replace with actual logic)
function validateAccountNumber(accountNumber) {
    // Replace this with actual account number validation logic
    return accountNumber === '12345678';  // Example: Account number "12345" is valid
}

// Function to send a message via the Messenger API
function sendMessage(senderId, messageText) {
    const messageData = {
        recipient: { id: senderId },
        message: { text: messageText }
    };

    axios.post(`https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData)
        .then(response => {
            console.log('Message sent:', response.data);
        })
        .catch(error => {
            console.error('Error sending message:', error);
        });
}

const PORT = 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
