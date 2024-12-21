const express = require('express'); 
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = 'EAAGizoa2IFwBO63KQWgiZA1MdrnarUo8iEsOn1WS4hlpyoSRZCNS5ok9cEcxekdFVyH1ZAblGg7a5CrSYG967IxZB1jahELmoxNQq1b77PaYrTk9DTCPeq5Rm8JqGj6PBgJJ7ETmphqlA2fJixMKMEKZCQQ6QO9m64vsgqWGmsbNH6oFKybELCZCZBCSWmlNtcs3AZDZD';
const PAGE_ACCESS_TOKEN = 'EAAGizoa2IFwBO9h75MsQZCF0mIQUs2ZAOj6np59gElARZCYAEv8vQfQw1f0RekYOav7F25lwz7QaIdz2JRshoM2GAgiqvJZBPK10GziTs4HB6TU5a8ZCkDCMLqGJrGacgZCsZCA3ZCdCSsnVyGFZAZCC2HT7ZAfDmal8YZBOMHSwLI3bkZAQoZBSxwm8zwxZC1DN3lbSvFbywZDZD';

// Define a temporary storage for user conversations (this can be replaced with a database)
let userSessions = {};

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
            // Check if the entry has any messaging data
            if (entry.messaging && entry.messaging.length > 0) {
                const webhookEvent = entry.messaging[0];
                const senderId = webhookEvent.sender.id;

                console.log(webhookEvent);

                // Check if the user is already in the conversation flow
                if (!userSessions[senderId]) {
                    // Start the conversation by showing the main menu
                    userSessions[senderId] = { step: 'main_menu' };
                    sendMainMenu(senderId);
                } else {
                    // Handle conversation flow based on the current step
                    handleUserMessage(senderId, webhookEvent.message.text);
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

// Function to send a menu for contact information options
function sendContactInfoMenu(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            text: "Where do you want to receive your One-time Password (OTP)?:",
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
                },
                {
                    content_type: "text",
                    title: "UPDATE CONTACT INFO",
                    payload: "UPDATE_CONTACT"
                }
            ]
        }
    };

    axios.post(`https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData)
        .then(response => {
            console.log('Contact info menu sent:', response.data);
        })
        .catch(error => {
            console.error('Error sending contact info menu:', error);
        });
}

// Handle user responses based on the step they are in
function handleUserMessage(senderId, message) {
    switch (userSessions[senderId].step) {
        case 'main_menu':
            if (message === "BILL INQUIRY") {
                userSessions[senderId].step = 'ask_account';
                sendMessage(senderId, 'Please provide your 8-digit account number.');
            } else {
                sendMessage(senderId, 'Sorry, I can only assist with Bill Inquiry at the moment. Please choose it from the options.');
            }
            break;

        case 'ask_account':
            // Validate the account number (replace with your actual verification logic)
            if (validateAccountNumber(message)) {
                userSessions[senderId].step = 'ask_verification_method';
                // sendMessage(senderId, 'Where do you want to receive your One-time Password (OTP): MOBILE NUMBER, EMAIL ADDRESS, or UPDATE CONTACT INFO.');
                sendContactInfoMenu(senderId);
            } else {
                sendMessage(senderId, 'Sorry, the account number you provided is invalid. Please try again.');
            }
            break;

        case 'ask_verification_method':
            // Handle the user's choice for contact method
            if (message === "MOBILE NUMBER" || message === "EMAIL ADDRESS") {
                userSessions[senderId].step = 'collect_contact_info';
                sendMessage(senderId, `Please provide your ${message.toLowerCase()}.`);
            } else if (message === "UPDATE CONTACT INFO") {
                userSessions[senderId].step = 'update_contact_info';
                sendMessage(senderId, 'Please provide your new contact information.');
            } else {
                sendMessage(senderId, 'Invalid selection. Please choose from the options provided.');
            }
            break;

        case 'collect_contact_info':
            // Collect the contact information (mobile or email)
            if (validateVerificationMethod(message)) {
                userSessions[senderId].step = 'show_balance';
                sendMessage(senderId, 'Your Total Amount Due for the month of December 2024 is Php1,234.00.');
            } else {
                sendMessage(senderId, 'Sorry, the information you provided is invalid. Please provide a valid mobile number or email.');
            }
            break;

        case 'update_contact_info':
            // Handle the logic for updating contact info
            sendMessage(senderId, 'Your contact info has been updated successfully.');
            userSessions[senderId].step = 'show_balance';
            sendMessage(senderId, 'Your Total Amount Due for the month of December 2024 is Php1,234.00.');
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

// Function to validate the verification method (mobile number or email)
function validateVerificationMethod(info) {
    // For simplicity, we are just checking if the info looks like an email or phone number
    const phoneRegex = /^[0-9]{10}$/;
    const emailRegex = /^[\w-]+(\.[\w-]+)*@([\w-]+\.)+[a-zA-Z]{2,7}$/;

    return phoneRegex.test(info) || emailRegex.test(info);
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
