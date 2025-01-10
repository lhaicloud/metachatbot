const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const path = require("path");
require("dotenv").config();

//// please keep this part
const nodemailer = require("nodemailer");


//also revise this 
const app = express();
app.use(bodyParser.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));

const VERIFY_TOKEN = "L3tm3V3ri1fy@2024";
const PAGE_ACCESS_TOKEN =
    "EAAGizoa2IFwBO9h75MsQZCF0mIQUs2ZAOj6np59gElARZCYAEv8vQfQw1f0RekYOav7F25lwz7QaIdz2JRshoM2GAgiqvJZBPK10GziTs4HB6TU5a8ZCkDCMLqGJrGacgZCsZCA3ZCdCSsnVyGFZAZCC2HT7ZAfDmal8YZBOMHSwLI3bkZAQoZBSxwm8zwxZC1DN3lbSvFbywZDZD";

// Define a temporary storage for user conversations (this can be replaced with a database)
let userSessions = {};

// Temporary storage for OTP generation (to simulate OTP validation)
let otps = {};

let transporter = nodemailer.createTransport({
    host: process.env.WP_SMTP_HOST,
    port: process.env.WP_SMTP_PORT || 465, // Use 465 for SSL
    secure: true, // Use SSL/TLS
    auth: {
        user: process.env.WP_SMTP_USER,
        pass: process.env.WP_SMTP_PASS,
    },
});

// Webhook verification (Meta setup)
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("Webhook verified!");
        res.status(200).send(challenge);
    } else {
        console.log("Webhook verification failed");
        res.sendStatus(403);
    }
});

// Webhook to handle incoming messages
app.post("/webhook", (req, res) => {
    const body = req.body;

    if (body.object === "page") {
        body.entry.forEach((entry) => {
            if (entry.messaging && entry.messaging.length > 0) {
                const webhookEvent = entry.messaging[0];
                const senderId = webhookEvent.sender.id;

                console.log(webhookEvent);

                // Check if it's a postback (e.g., from a button click or quick reply)
                if (webhookEvent.postback) {
                    const postbackPayload = webhookEvent.postback.payload;
                    console.log("Postback received:", postbackPayload);

                    // Handle postback action
                    handlePostback(senderId, postbackPayload);
                }
                // Check if it's a text message
                else if (webhookEvent.message && webhookEvent.message.text) {
                    console.log("Text received:", webhookEvent.message.text);
                    handleUserMessage(senderId, webhookEvent.message.text);
                }
                // Check if it's a location
                else if (webhookEvent.message && webhookEvent.message.attachments) {
                    const location = webhookEvent.message.attachments.find(attachment => attachment.type === 'location');
                    if (location) {
                        console.log('Received location:', location.payload);
                        // Process location data
                        handleLocation(senderId, location.payload);
                    }
                } else {
                    console.log("No text or postback message found");
                }
            } else {
                console.log("No messaging data found in entry:", entry);
            }
        });

        res.status(200).send("EVENT_RECEIVED");
    } else {
        res.sendStatus(404);
    }
});

function handlePostback(senderId, payload) {
    switch (payload) {
        case "WELCOME_MESSAGE":
            userSessions[senderId] = { step: "main_menu" };
            sendMainMenu(senderId);
            break;
        case "BACK_TO_PREVIOUS_MENU":
            userSessions[senderId].step = "main_menu"; // Go back to the main menu
            sendMainMenu(senderId); // Send the main menu again
            break;
        case "BILL_INQUIRY":
            userSessions[senderId].step = "ask_account";
            sendMessage(senderId, "Please provide your 8-digit account number.");
            break;
        case "MOBILE_NUMBER":
            userSessions[senderId].step = "validate_otp";
            sendOTP(senderId, "MOBILE NUMBER");
            sendOTPMessage(
                senderId,
                "Thank you. Please enter the One-time Password (OTP) send to your registered mobile number."
            );
            break;
        case "EMAIL_ADDRESS":
            userSessions[senderId].step = "validate_otp";
            sendOTP(senderId, "EMAIL ADDRESS");
            sendOTPMessage(
                senderId,
                "Thank you. Please enter the One-time Password (OTP) send to your registered email address."
            );
            break;
        case "RESEND_OTP":
            if (userSessions[senderId].lastContactMethod) {
                if (userSessions[senderId].lastContactMethod == "MOBILE NUMBER") {
                    sendOTP(senderId, "MOBILE NUMBER");
                    sendOTPMessage(
                        senderId,
                        "Thank you. Please enter the One-time Password (OTP) send to your registered mobile number."
                    );
                } else if (
                    userSessions[senderId].lastContactMethod == "EMAIL ADDRESS"
                ) {
                    sendOTP(senderId, "EMAIL ADDRESS");
                    sendOTPMessage(
                        senderId,
                        "Thank you. Please enter the One-time Password (OTP send to your registered email address."
                    );
                }
            } else {
                sendOTPChoiceMenu(senderId);
            }
            break;
        case "CHANGE_OTP_METHOD":
            userSessions[senderId].step = "ask_otp_method";
            sendOTPChoiceMenu(senderId);
            break;
        case "UPDATE_CONTACT_INFO":
            userSessions[senderId].updating_information = true;
            userSessions[senderId].step = "update_contact_info";
            // sendContactInfoMenu(senderId);
            sendChooseMobileorEmailMenu(senderId);
            break;
        case "UPDATE_NOW":
            userSessions[senderId].updating_information = true;
            sendChooseMobileorEmailMenu(senderId);
            break;
        case "END_CHAT":
            endChat(senderId);
            delete userSessions[senderId];
            break;
        case "ASK_MOBILE_NUMBER":
            userSessions[senderId].step = "ask_mobile_number";
            sendMessage(senderId, "Please enter your mobile number");
            break;
        case "ASK_EMAIL_ADDRESS":
            userSessions[senderId].step = "ask_email_address";
            sendMessage(senderId, "Please enter your email address");
            break;
        case "YES_ANOTHER_CONCERN":
            userSessions[senderId] = { step: "main_menu" };
            sendMainMenu(senderId);
            break;
        case "BACK_TO_PREVIOUS_MENU2":
            userSessions[senderId].updating_information = false;
            userSessions[senderId].step = "ask_otp_method";
            sendOTPChoiceMenu(senderId);
            break; 
        default:
            sendMessage(senderId, "Sorry, I didn't understand that action.");
            break;
    }
}

function handleLocation(senderId, location) {
    console.log(`Handling location for sender ${senderId}:`, location);
    // Perform actions with the location, such as saving to database or sending a confirmation
}
// Function to send the main menu with Bill Inquiry option
function sendMainMenu(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Welcome! How can I assist you today?",
                    buttons: [{
                            type: "postback",
                            title: "BILL INQUIRY",
                            payload: "BILL_INQUIRY",
                        },
                        {
                            type: "postback",
                            title: "REPORT AN INTERRUPTION",
                            payload: "REPORT_AN_INTERRUPTION",
                        },
                        {
                            type: "postback",
                            title: "ACCOUNT CONCERN",
                            payload: "ACCOUNT_CONCERN",
                        },
                    ],
                },
            },
        },
    };

    axios
        .post(
            `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            messageData
        )
        .then((response) => {
            console.log("Button Template sent:", response.data);
        })
        .catch((error) => {
            console.error("Error sending button template:", error);
        });
}

function sendOTPMessage(senderId, messageText) {
    const buttons = [{
        type: "postback",
        title: "RESEND OTP",
        payload: "RESEND_OTP",
    }, ];

    if (!userSessions[senderId].updating_information) {
        buttons.push({
            type: "postback",
            title: "CHANGE OTP METHOD",
            payload: "CHANGE_OTP_METHOD",
        });
    }

    const messageData = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: messageText,
                    buttons: buttons,
                },
            },
        },
    };

    axios
        .post(
            `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            messageData
        )
        .then((response) => {
            console.log("OTP choice menu sent:", response.data);
        })
        .catch((error) => {
            console.error("Error sending OTP choice menu:", error);
        });
}

function sendChooseMobileorEmailMenu(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Please choose what information you want to update.",
                    buttons: [{
                            type: "postback",
                            title: "MOBILE NUMBER",
                            payload: "ASK_MOBILE_NUMBER",
                        },
                        {
                            type: "postback",
                            title: "EMAIL ADDRESS",
                            payload: "ASK_EMAIL_ADDRESS",
                        },
                        {
                            type: "postback",
                            title: "BACK TO PREVIOUS MENU",
                            payload: "BACK_TO_PREVIOUS_MENU2",
                        },
                    ],
                },
            },
        },
    };

    axios
        .post(
            `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            messageData
        )
        .then((response) => {
            console.log("OTP choice menu sent:", response.data);
        })
        .catch((error) => {
            console.error("Error sending OTP choice menu:", error);
        });
}

// Function to send OTP delivery choice menu
function sendOTPChoiceMenu(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: `Hi Mr./Mrs. ${capitalizeWords(
            userSessions[senderId].account.cflastname
          )}! Where do you want to receive your One-Time Password (OTP)? `,
                    buttons: [{
                            type: "postback",
                            title: "MOBILE NUMBER",
                            payload: "MOBILE_NUMBER",
                        },
                        {
                            type: "postback",
                            title: "EMAIL ADDRESS",
                            payload: "EMAIL_ADDRESS",
                        },
                        {
                            type: "postback",
                            title: "UPDATE CONTACT INFO",
                            payload: "UPDATE_CONTACT_INFO",
                        },
                    ],
                },
            },
        },
    };

    axios
        .post(
            `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            messageData
        )
        .then((response) => {
            console.log("OTP choice menu sent:", response.data);
        })
        .catch((error) => {
            console.error("Error sending OTP choice menu:", error);
        });
}

function sendContactInfoMenu(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "You can update your contact information via the CASURECO 1 App or by clicking the UPDATE NOW button.",
                    buttons: [{
                            type: "web_url",
                            url: "https://play.google.com/store/apps/details?id=org.casureco1.dev&hl=en&pli=1",
                            title: "OPEN APP",
                        },
                        {
                            type: "postback",
                            title: "UPDATE NOW",
                            payload: "UPDATE_NOW",
                        },
                        {
                            type: "postback",
                            title: "BACK TO PREVIOUS MENU",
                            payload: "BACK_TO_PREVIOUS_MENU",
                        },
                    ],
                },
            },
        },
    };

    axios
        .post(
            `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            messageData
        )
        .then((response) => {
            console.log("OTP choice menu sent:", response.data);
        })
        .catch((error) => {
            console.error("Error sending OTP choice menu:", error);
        });
}

// Function to send OTP message
function sendOTP(senderId, contactMethod) {
    const otp = Math.floor(100000 + Math.random() * 900000); // Generate a 6-digit OTP
    otps[senderId] = { otp, timestamp: Date.now() };

    userSessions[senderId].lastContactMethod = contactMethod; // Store contact method for resending

    contactMethodText = contactMethod.toLowerCase();

    content = `Dear Mr./Mrs. ${capitalizeWords(
    userSessions[senderId].account.cflastname
  )},\nYour One-Time Password (OTP) is ${otp}.\n\nPlease use this OTP to complete your verification process. Do not share this code with anyone.\nThank you.`;
    sendEmail("lhaicloud123@gmail.com", "CASURECO 1 OTP", content);

    // const messageData = {
    //     recipient: { id: senderId },
    //     message: {
    //         text: `Your OTP is ${otp}. Please enter it to verify. OTP has been sent to your ${contactMethodText}.`
    //     }
    // };

    // axios.post(`https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData)
    // .then(response => {
    //     console.log('OTP sent:', response.data);
    // })
    // .catch(error => {
    //     console.error('Error sending OTP:', error);
    // });
}

// Handle user responses based on the step they are in
async function handleUserMessage(senderId, message) {
    // Ensure that the user session exists
    if (!userSessions[senderId]) {
        userSessions[senderId] = { step: "main_menu" }; // Initialize the session with 'main_menu'
    }

    switch (userSessions[senderId].step) {
        // case 'main_menu':
        //     if (message === "BILL INQUIRY") {
        //         userSessions[senderId].step = 'ask_account';
        //         sendMessage(senderId, 'Please provide your 8-digit account number.');
        //     } else if (message === "UPDATE CONTACT INFO") {
        //         userSessions[senderId].step = 'ask_verification_method';
        //         sendOTPChoiceMenu(senderId);
        //     } else {
        //         sendMessage(senderId, 'Sorry, I can only assist with Bill Inquiry and Update Contact Info at the moment. Please choose one.');
        //         sendMainMenu(senderId);
        //     }
        //     break;
        case "ask_account":
            // Validate the account number (replace with your actual verification logic)
            validateAccountNumber(message, senderId)
                .then((isValid) => {
                    console.log("Is Valid Account Number:", isValid);
                    if (isValid == true) {
                        userSessions[senderId].step = "ask_otp_method";
                        sendOTPChoiceMenu(senderId);
                    } else {
                        sendMessage(
                            senderId,
                            "Sorry, the account number you provided is invalid. See image for your reference.",
                            true
                        );
                    }
                })
                .catch((error) => {
                    console.error(
                        "Error occurred while validating account number:",
                        error
                    );
                });
            // if (validateAccountNumber(message,senderId) == true) {
            //     userSessions[senderId].step = 'ask_otp_method';
            //     sendOTPChoiceMenu(senderId);
            // } else {
            //     sendMessage(senderId, 'Sorry, the account number you provided is invalid. See image for your reference.',true);
            // }
            break;
        case "ask_otp_method":
            if (message === "MOBILE NUMBER" || message === "EMAIL ADDRESS") {
                userSessions[senderId].step = "validate_otp";
                sendOTP(senderId, message.toUpperCase());
            } else {
                sendMessage(
                    senderId,
                    "Invalid selection. Please choose from the options provided."
                );
            }
            break;
        case "validate_otp":
            // Check if the OTP exists for the sender
            if (otps[senderId]) {
                // Check if OTP has expired (10 minutes)
                if (Date.now() - otps[senderId].timestamp > 1 * 60 * 1000) {
                    sendMessage(
                        senderId,
                        "Your OTP has expired. Please request a new one."
                    );
                    userSessions[senderId].step = "ask_otp_method"; // Prompt user to request a new OTP
                    sendOTPChoiceMenu(senderId); // Provide options to request a new OTP
                } else if (message === otps[senderId].otp.toString()) {
                    // Check if OTP is correct

                    if (userSessions[senderId].updating_information) {
                        sendMessage(
                            senderId,
                            "Your contact information has been updated successfully."
                        );
                        setTimeout(() => {
                            sendFinalMenu(senderId);
                        }, 200);

                        break;
                    }
                    userSessions[senderId].step = "verified";
                    sendMessage(
                        senderId,
                        "Your Total Amount Due for the month of December 2024 is 1,234.00 pesos."
                    );
                    setTimeout(() => {
                        sendFinalMenu(senderId);
                    }, 200);
                    // Send a message indicating chat has ended
                    // sendMessage(senderId, 'Chat has ended. If you need further assistance, feel free to reach out again.');

                    // Reset the session to end the chat and stop further steps
                    // userSessions[senderId].step = 'chat_ended';

                    // Send the "Back to previous menu" option
                    // sendBackToPreviousMenu(senderId); // Show the option to go back
                } else {
                    sendOTPMessage(
                        senderId,
                        'Invalid OTP. Please try again or select "Resend OTP" to get a new one.'
                    );
                }
            } else {
                sendMessage(senderId, "No OTP found. Please request a new one.");
                userSessions[senderId].step = "ask_otp_method"; // Prompt user to request a new OTP
                sendOTPChoiceMenu(senderId); // Provide options to request a new OTP
            }
            break;
        case "resend_otp":
            if (message === "RESEND OTP") {
                sendOTP(senderId, userSessions[senderId].lastContactMethod);
                userSessions[senderId].step = "validate_otp"; // Return to OTP validation step
            } else if (otps[senderId] && message === otps[senderId].otp.toString()) {
                userSessions[senderId].step = "verified";
                sendMessage(
                    senderId,
                    "Your Total Amount Due for the month of December 2024 is Php 1,234.00 pesos"
                );
                setTimeout(() => {
                    sendFinalMenu(senderId);
                }, 200);
            } else {
                sendMessage(
                    senderId,
                    'Invalid input. Please try again or select "Resend OTP".'
                );
            }
            break;
        case "ask_mobile_number":
            userSessions[senderId].step = "validate_otp";
            sendOTP(senderId, "MOBILE NUMBER");
            sendOTPMessage(
                senderId,
                "Thank you. Please enter the One-time Password (OTP) send to your registered mobile number."
            );
            break;
        case "ask_email_address":
            userSessions[senderId].step = "validate_otp";
            sendOTP(senderId, "EMAIL ADDRESS");
            sendOTPMessage(
                senderId,
                "Thank you. Please enter the One-time Password (OTP) send to your registered email address."
            );
            break;
        default:
            // sendMessage(senderId, 'I\'m not sure what you need. Please start again.');
            sendMainMenu(senderId);
            break;
    }
}

function sendFinalMenu(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Do you have another concern?",
                    buttons: [{
                            type: "postback",
                            title: "YES, I DO",
                            payload: "YES_ANOTHER_CONCERN",
                        },
                        {
                            type: "postback",
                            title: "NO, THAT'S ALL FOR NOW. THANK YOU!",
                            payload: "END_CHAT",
                        },
                    ],
                },
            },
        },
    };

    axios
        .post(
            `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            messageData
        )
        .then((response) => {
            console.log("OTP choice menu sent:", response.data);
        })
        .catch((error) => {
            console.error("Error sending OTP choice menu:", error);
        });
}

function endChat(senderId) {
    const message = {
        recipient: { id: senderId },
        message: {
            text: "Thank you for contacting us! If you have any further questions, feel free to reach out anytime. Have a great day!",
        },
    };

    axios
        .post(
            `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            message
        )
        .then((response) => {
            console.log("Chat ended message sent:", response.data);
        })
        .catch((error) => {
            console.error("Error ending chat:", error);
        });
}

function markAsDone(senderId) {
    const data = {
        recipient: { id: senderId },
        sender_action: "mark_seen",
    };

    axios
        .post(
            `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            data
        )
        .then((response) => {
            console.log("Conversation marked as done:", response.data);
        })
        .catch((error) => {
            console.error("Error marking as done:", error);
        });
}

function sendBackToPreviousMenu(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            text: "Would you like to go back to the previous menu?",
            quick_replies: [{
                content_type: "text",
                title: "BACK TO PREVIOUS MENU",
                payload: "BACK_TO_PREVIOUS_MENU",
            }, ],
        },
    };

    axios
        .post(
            `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            messageData
        )
        .then((response) => {
            console.log("Back to previous menu sent:", response.data);
        })
        .catch((error) => {
            console.error("Error sending back to previous menu:", error);
        });
}

// Function to validate account number (replace with actual logic)
async function validateAccountNumber(accountNumber, senderId) {
    const cleanedAccountNumber = accountNumber.replace(/[^0-9]/g, ""); // Keeps only digits

    try {
        const response = await axios.get(
            `https://casureco1api.com/billinquiry/findCAN`, {
                params: { account_number: cleanedAccountNumber },
                headers: {
                    Authorization: `Bearer ${process.env.API_KEY}`, // Authorization Bearer Token
                },
            }
        );

        if (response.data.success === true) {
            userSessions[senderId].account = response.data.data;
            return true; // Return true for valid account number
        } else {
            return false; // Return false for invalid account number
        }
    } catch (error) {
        console.error("Error:", error.message);
        return false; // Return false in case of an error
    }
}

// Function to send a message via the Messenger API
function sendMessage(senderId, messageText, withImage = false) {
    const message = {
        recipient: { id: senderId },
        message: { text: messageText },
    };
    const messageWithImage = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "generic",
                    elements: [{
                        title: "INVALID ACCOUNT",
                        subtitle: messageText,
                        image_url: "https://metabillinquiry.onrender.com/billing_notice2.jpg",
                    }, ],
                },
            },
        },
    };

    messageData = withImage ? messageWithImage : message;

    axios
        .post(
            `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            messageData
        )
        .then((response) => {
            console.log("Message sent:", response.data);
        })
        .catch((error) => {
            console.error("Error sending message:", error);
        });
}

function sendEmail(to, subject, text) {
    let mailOptions = {
        from: process.env.WP_SMTP_USER,
        to: to,
        subject: subject,
        text: text,
    };

    transporter.sendMail(mailOptions, function(error, info) {
        if (error) {
            console.log(error);
        } else {
            console.log("Email sent: " + info.response);
        }
    });
}

function capitalizeWords(str) {
    if (!str) return str; // Handle empty or null strings
    return str
        .split(" ") // Split the string into words
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) // Capitalize each word
        .join(" "); // Join the words back together
}

const PORT = 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));