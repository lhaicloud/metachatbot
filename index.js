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
            // Check if 'messaging' exists and is an array with elements
            if (entry.messaging && Array.isArray(entry.messaging) && entry.messaging.length > 0) {
                const webhookEvent = entry.messaging[0];
                const senderId = webhookEvent.sender.id;

                console.log('Webhook event:', webhookEvent);  // Log the webhook event to understand its structure

                // Check if the 'message' and 'text' properties exist before proceeding
                if (webhookEvent.message && webhookEvent.message.text) {
                    const userMessage = webhookEvent.message.text;

                    console.log(`Received message from user ${senderId}: ${userMessage}`);

                    // Handle conversation flow based on the current step
                    if (!userSessions[senderId]) {
                        // Start the conversation by showing the main menu
                        userSessions[senderId] = { step: 'main_menu' };
                        sendMainMenu(senderId);
                    } else {
                        handleUserMessage(senderId, userMessage);
                    }
                } else {
                    console.log(`No 'text' message found in webhookEvent for sender ${senderId}`);
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
                    title: "UPDATE CONTACT INFO",
                    payload: "UPDATE_CONTACT"
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

// Function to send the menu for contact information options after choosing "Update Contact Info"
function sendContactInfoMenu(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            text: "Where do you want to receive your One-time Password (OTP)?",
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
            console.log('Contact info menu sent:', response.data);
        })
        .catch(error => {
            console.error('Error sending contact info menu:', error);
        });
}

// Function to send OTP instructions based on user's selection
function sendOTPInstructions(senderId, contactMethod) {
    const message = contactMethod === "MOBILE_NUMBER"
        ? "Please check your inbox for the OTP sent and enter it below."
        : "Please check your inbox for the OTP sent and enter it below.";

    sendMessage(senderId, message);
    userSessions[senderId].step = 'enter_otp';
}

// Function to handle OTP validation
function handleOTPValidation(senderId, otpEntered) {
    // Replace with real OTP validation logic
    const validOTP = "123456";  // Example: OTP for validation

    if (otpEntered === validOTP) {
        sendBalance(senderId);
    } else {
        sendMessage(senderId, 'The OTP you entered is incorrect. Please try again.');
    }
}

// Function to send the balance amount after OTP validation
function sendBalance(senderId) {
    const message = "Your Total Amount Due for the month of December 2024 is Php1,234.00.";
    sendMessage(senderId, message);
    sendMainMenu(senderId)
    // sendGetStartedMenu(senderId);  // Show "GET STARTED AGAIN" menu
}


// Handle user responses based on the step they are in
function handleUserMessage(senderId, message) {
    switch (userSessions[senderId].step) {
        case 'main_menu':
            if (message === "BILL INQUIRY") {
                userSessions[senderId].step = 'ask_account';
                sendMessage(senderId, 'Please provide your 8-digit account number.');
            } else if (message === "UPDATE_CONTACT") {
                userSessions[senderId].step = 'update_contact_info';
                sendContactInfoMenu(senderId);
            } else {
                sendMessage(senderId, 'Sorry, I can only assist with Bill Inquiry and Update Contact Info at the moment.');
            }
            break;

        case 'update_contact_info':
            sendContactInfoMenu(senderId);
            break;

        case 'enter_otp':
            handleOTPValidation(senderId, message);
            break;

        case 'show_balance':
            sendMessage(senderId, 'Your Total Amount Due for the month of December 2024 is Php1,234.00');
            sendMainMenu(senderId); // Show "GET STARTED AGAIN" menu
            break;

        default:
            sendMessage(senderId, 'I\'m not sure what you need. Please start again.');
            break;
    }
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
