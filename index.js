const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = 'L3tm3V3ri1fy@2024';
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
        case 'BACK_TO_PREVIOUS_MENU':
            userSessions[senderId].step = 'main_menu'; // Go back to the main menu
            sendMainMenu(senderId);  // Send the main menu again
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

    axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData)
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
    otps[senderId] = { otp, timestamp: Date.now() };

    userSessions[senderId].lastContactMethod = contactMethod; // Store contact method for resending

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
    // Ensure that the user session exists
    if (!userSessions[senderId]) {
        userSessions[senderId] = { step: 'main_menu' };  // Initialize the session with 'main_menu'
    }

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
                sendMainMenu(senderId);
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
        case 'validate_otp':
            // Check if the OTP exists for the sender
            if (otps[senderId]) {
                // Check if OTP has expired (10 minutes)
                if (Date.now() - otps[senderId].timestamp > 1 * 60 * 1000) {
                    sendMessage(senderId, 'Your OTP has expired. Please request a new one.');
                    userSessions[senderId].step = 'ask_otp_method'; // Prompt user to request a new OTP
                    sendOTPChoiceMenu(senderId); // Provide options to request a new OTP
                } else if (message === otps[senderId].otp.toString()) { // Check if OTP is correct
                    userSessions[senderId].step = 'verified';
                    sendMessage(senderId, 'Your Total Amount Due for the month of December 2024 is Php 1,234.00');

                    // Send a message indicating chat has ended
                    sendMessage(senderId, 'Chat has ended. If you need further assistance, feel free to reach out again.');

                    // Reset the session to end the chat and stop further steps
                    userSessions[senderId].step = 'chat_ended';

                    // Send the "Back to previous menu" option
                    sendBackToPreviousMenu(senderId); // Show the option to go back
                } else {
                    sendResendOTPMenu(senderId);
                }
            } else {
                sendMessage(senderId, 'No OTP found. Please request a new one.');
                userSessions[senderId].step = 'ask_otp_method'; // Prompt user to request a new OTP
                sendOTPChoiceMenu(senderId); // Provide options to request a new OTP
            }
            break;
        case 'resend_otp':
                if (message === "RESEND OTP") {
                    sendOTP(senderId, userSessions[senderId].lastContactMethod);
                    userSessions[senderId].step = 'validate_otp'; // Return to OTP validation step
                } else if (otps[senderId] && message === otps[senderId].otp.toString()) {
                    userSessions[senderId].step = 'verified';
                    sendMessage(senderId, 'Your Total Amount Due for the month of December 2024 is Php 1,234.00');
                    sendMessage(senderId, 'Chat has ended. If you need further assistance, feel free to reach out again.');
                    userSessions[senderId].step = 'chat_ended';
                } else {
                    sendMessage(senderId, 'Invalid input. Please try again or select "Resend OTP".');
                }
                break;

            
        default:
            sendMessage(senderId, 'I\'m not sure what you need. Please start again.');
            sendMainMenu(senderId);
            break;
    }
}

function sendResendOTPMenu(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            text: 'Invalid OTP. Please try again or select "Resend OTP" to get a new one.',
            quick_replies: [
                {
                    content_type: "text",
                    title: "RESEND OTP",
                    payload: "RESEND_OTP"
                }
            ]
        }
    };

    axios.post(`https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData)
        .then(response => {
            console.log('Resend OTP menu sent:', response.data);
            userSessions[senderId].step = 'resend_otp';
        })
        .catch(error => {
            console.error('Error sending Resend OTP menu:', error);
        });
}

function sendBackToPreviousMenu(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            text: "Would you like to go back to the previous menu?",
            quick_replies: [
                {
                    content_type: "text",
                    title: "BACK TO PREVIOUS MENU",
                    payload: "BACK_TO_PREVIOUS_MENU"
                }
            ]
        }
    };

    axios.post(`https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData)
        .then(response => {
            console.log('Back to previous menu sent:', response.data);
        })
        .catch(error => {
            console.error('Error sending back to previous menu:', error);
        });
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
