import express, { response } from "express";
import bodyParser from "body-parser";
import axios from "axios";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from 'dotenv';
import { categorizeMessage } from './categorize.js';
const fuzz = await import('fuzzball');
import fs from 'fs';

const max_attempts = 5
dotenv.config();

const app = express();
app.use(bodyParser.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/', (req, res) => {
    res.send('<center><h1>Welcome<br/>to<br/>CASURECO 1 META API</h1></center>');
});


// Define a temporary storage for user conversations (this can be replaced with a database)
let userSessions = {};

// Temporary storage for OTP generation (to simulate OTP validation)
let otps = {};

const answers = ['yes','oo','opo','yeah','yep','yup','sure','okay','alright','absolutely','of course','correct','right'];
var psgcData = []
var municipalities = []
var barangays = []

let transporter = nodemailer.createTransport({
    host: "mail.casureco1.com",
    port: 465, // Use 465 for SSL
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
    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
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
                console.log(userSessions[senderId])
                // Check if it's a postback (e.g., from a button click or quick reply)
                if (webhookEvent.postback) {
                    const postbackPayload = webhookEvent.postback.payload;
                    console.log("Postback received:", postbackPayload);

                    // Ensure user session exists, initialize if not
                    if (!userSessions[senderId]) {
                        userSessions[senderId] = {}; // Initialize user session if it doesn't exist
                    }

                     // If user has not seen privacy policy yet, show it
                    if (!userSessions[senderId].privacyPolicySeen) {
                        showPrivacyPolicy(senderId); // Show privacy policy
                        userSessions[senderId].privacyPolicySeen = true; // Mark privacy policy as seen
                    } else {
                        // Handle postback (e.g., Proceed button clicked)
                        if (postbackPayload === "PROCEED") {
                            // Set the user's step to show the main menu
                            userSessions[senderId].step = "main_menu"; 
                            sendMainMenu(senderId); // Show main menu
                        } else {
                            // Handle other postbacks here
                            handlePostback(senderId, postbackPayload); // Handle other types of postbacks
                        }
                    }
                    
                    
                }else if(webhookEvent.message && webhookEvent.message.quick_reply){ // Check if it's a quick message
                    const payload = webhookEvent.message.quick_reply.payload;
                   
                }
                // Check if it's a text message
                else if (webhookEvent.message && webhookEvent.message.text) {
                    console.log("Text received:", webhookEvent.message.text);
                    const tokens = preprocessMessage(webhookEvent.message.text);
                    const category = categorizeMessage(tokens);
                    console.log(`Message categorized as: ${category}`);
                    handleUserMessage(senderId, webhookEvent.message.text,category);
                }
                // Check if it's a location
                else if (webhookEvent.message && webhookEvent.message.attachments) {
                    const locationData = webhookEvent.message.attachments.find(attachment => attachment.type === 'location');
                    if (locationData) {
                        console.log('Location received:', locationData);
                        // Handle location data (latitude, longitude)
                        handleLocation(senderId, locationData);
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

app.use((req, res) => {
    res.status(404).send('<h1>404 - Page Not Found</h1>');
});

await getPSGC().then((data) => { psgcData = data; municipalities = [...data].filter((d) => d.geo_level == 'Mun') }).catch((error) => {console.error('Error:', error);});
// setupPersistentMenu();

async function setupPersistentMenu(){
    const url = `https://graph.facebook.com/v17.0/me/messenger_profile?access_token=${process.env.PAGE_ACCESS_TOKEN}`;
    
    const persistentMenuPayload = {
        persistent_menu: [
            {
                locale: "default",
                composer_input_disabled: false, // Set to true if you want to disable text input
                call_to_actions: [
                    {
                        type: "postback",
                        title: "Main Menu",
                        payload: "MAIN_MENU"
                    },
                    {
                        type: "postback",
                        title: "View Bills & Payments",
                        payload: "VIEW_BILLS_PAYMENTS"
                    },
                    {
                        type: "web_url",
                        title: "Visit Website",
                        url: "https://casureco1.com",
                        webview_height_ratio: "full"
                    },
                    {
                        type: "postback",
                        title: "Chat with an Agent",
                        payload: "CHAT_AGENT"
                    },
                ]
            }
        ]
    };

    try {
        const response = await axios.post(url, persistentMenuPayload);
        console.log("Persistent Menu successfully set up:", response.data);
    } catch (error) {
        console.error("Failed to set up Persistent Menu:", error.response ? error.response.data : error.message);
    }
}


function callSendAPI(messageData){
    axios
        .post(
            `https://graph.facebook.com/v21.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
            messageData
        )
        .then((response) => {
            console.log("Sent:", response.data);
        })
        .catch((error) => {
            console.error("Error:", error);
        });
}
function showPrivacyPolicy(senderId){
    const messageTitle = "At CASURECO 1, we respect your privacy and are strongly committed to keeping secure any information we obtain from you or about you. We may access your Facebook profile and other personal data based on the services you use to improve your experience and keep your data private, unless required by law. Read our privacy policy to know more."

    const messageData = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: messageTitle,
                    buttons: [{
                            type: "web_url",
                            title: "Privacy Policy",
                            url: "https://casureco1.com",
                            webview_height_ratio: "full"
                        },
                        {
                            type: "postback",
                            title: "Proceed",
                            payload: "PROCEED",
                        },
                    ],
                },
            },
        },
    };

    callSendAPI(messageData);
}

function getPSGC() {
    return new Promise((resolve, reject) => {
      // Read the JSON file asynchronously
      fs.readFile('psgc.json', 'utf8', (err, data) => {
        if (err) {
          reject('Error reading the file:', err);
          return;
        }
  
        try {
          // Parse the JSON data
          var psgcParsedData = JSON.parse(data);
  
          // Check if municipalities list exists
          if (psgcParsedData) {
            psgcParsedData = psgcParsedData.sort((a, b) => a.name.localeCompare(b.name));
            resolve(psgcParsedData);
          } else {
            reject('No municipalities data found');
          }
        } catch (parseError) {
          reject('Error parsing JSON:', parseError);
        }
      });
    });
}

function preprocessMessage(message) {
    message = message.toLowerCase();
    message = message.replace(/[^a-z0-9\s]/g, '');
    return message.split(/\s+/);
}
function showBillorPayment(senderId){
    const messageData = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Please choose from the options provided to view your last 3 months' bill and payment details.",
                    buttons: [
                        {
                            type: "postback",
                            title: "Bill Details",
                            payload: "BILL_DETAILS",
                        },
                        {
                            type: "postback",
                            title: "Payment History",
                            payload: "PAYMENT_HISTORY",
                        },
                        {
                            type: "postback",
                            title: "Back to Previous Menu",
                            payload: "MAIN_MENU",
                        },
                    ],
                },
            },
        },
    };

    callSendAPI(messageData);
}
function handlePostback(senderId, payload) {
    switch (payload) {
        case "MAIN_MENU":
            userSessions[senderId].step = "main_menu" ;
            sendMainMenu(senderId);
            break;
        case "BILLS_PAYMENTS":
            showBillorPayment(senderId);
            // userSessions[senderId].step = "ask_account";
            // sendMessage(senderId, "Please provide your 8-digit account number.");
            break;
        case "BILL_DETAILS":
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
        case "REPORT_AN_OUTAGE":
            userSessions[senderId].step = "report_confirm_issue";
            sendReportConfirmIssue(senderId);
            break;
        default:
            sendMessage(senderId, "Sorry, I didn't understand that action.");
            break;
    }
}


// Handle user responses based on the step they are in
async function handleUserMessage(senderId, message,category) {
    // Ensure that the user session exists
    if (!userSessions[senderId]) {
        userSessions[senderId] = { step: "main_menu" }; // Initialize the session with 'main_menu'
        userSessions[senderId].attempts = 0;
    }
    console.log(`Handling message for sender: ${senderId}, category: ${category}`);

    switch (userSessions[senderId].step) {
        case 'main_menu':
            if (category === "bill_inquiry") {
                userSessions[senderId].step = 'ask_if_billinquiry';
                sendMessage(senderId, 'Do you want to know your bill?');
            } else if (category === "power_interruption") {
                userSessions[senderId].step = 'ask_if_power_interruption';
                sendMessage(senderId, 'Do you want to report a power interruption?');
            } else if (category === "account_concern") {
               
            } else {
                sendMainMenu(senderId);
            }
            break;
        case "ask_account":
            
            // Validate the account number (replace with your actual verification logic)
            validateAccountNumber(message, senderId)
                .then((isValid) => {
                    if (isValid == true) {
                        userSessions[senderId].step = "ask_account_name";
                        sendMessage(senderId, "Please provide your account name.");
                    } else {
                        userSessions[senderId].attempts += 1
                        sendMessage(senderId,"Sorry, the account number you provided is invalid. Please try again.");
                        // sendMessageWithImage(senderId,"https://crucial-whale-dear.ngrok-free.app/account_number.webp");
                        
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
        case "ask_account_name":
            validateAccountName(message, senderId)
            .then((isValid) => {
                if (isValid == true) {
                    var content = ''
                    getBalance(senderId)
                    .then((data) => {
                        if(data && data.length > 0){
                            content = `Your unpaid power bill(s): \n\n`

                            data.forEach(bill => {
                                var formatted_date = new Date(bill.dfdue).toLocaleDateString("en-US")
                                content += `Bill Month: ${bill.billmo} ${bill.billyear}\nAmount Due: PHP ${bill.total}\nDue Date: ${formatted_date} \n\n`
                            });
                            content += "Enjoy FAST, SECURE & HASSLE-FREE payments through mobile applications and collection centers that are within your reach like GCash, Maya, Land Bank, ECPay & Bayad Center Authorized Payment Partners. Click this link https://www.casureco1.com/#online-payment to see the list of authorized payment partners.\n\n If you already paid your bill, please ignore this message."
                        }else{
                            content = "There are no unpaid power bills on record\n\nYou may view your bills and payments through CASURECO 1 Mobile Application. To download the app click the link https://bit.ly/42bvJ83.";
                        }
                        sendMessage(senderId,content);
                        userSessions[senderId].step = 'done'
                    })
                    .catch((error) => {
                        content = "Error occurred while getting the balance"
                        sendMessage(senderId,content);
                        console.error(
                            "Error occurred while getting the balance:",
                            error
                        );
                    }).finally(() => {
                        setTimeout(() => {
                            sendFinalMenu(senderId);
                        }, 1000);
                    });
                } else {
                    sendMessage(senderId,"Sorry, the account name you provided is invalid. Account name must be exactly the same with the Billing Notice or Receipt. Please try again.");
                    // sendMessageWithImage(senderId,"https://crucial-whale-dear.ngrok-free.app/account_name.webp");
                }
            })
            .catch((error) => {
                console.error(
                    "Error occurred while validating account name:",
                    error
                );
            });
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
                    var content = ''
                    getBalance(senderId)
                    .then((data) => {
                        if(data && data.length > 0){
                            content = `Your unpaid power bill(s): \n\n`

                            data.forEach(bill => {
                                var formatted_date = new Date(bill.dfdue).toLocaleDateString("en-US")
                                content += `Bill Month: ${bill.billmo} ${bill.billyear}\nAmount Due: PHP ${bill.total}\nDue Date: ${formatted_date} \n\n`
                            });
                            content += "Enjoy FAST, SECURE & HASSLE-FREE payments through mobile applications and collection centers that are within your reach like GCash, Maya, Land Bank, ECPay & Bayad Center Authorized Payment Partners. Click this link https://www.casureco1.com/#online-payment to see the list of authorized payment partners.\n\n If you already paid your bill, please ignore this message."
                        }else{
                            content = "There are no unpaid power bills on record\n\nYou may view your bills and payments through CASURECO 1 Mobile Application. To download the app click the link https://bit.ly/42bvJ83.";
                        }
                        sendMessage(senderId,content);
                    })
                    .catch((error) => {
                        content = "Error occurred while getting the balance"
                        sendMessage(senderId,content);
                        console.error(
                            "Error occurred while getting the balance:",
                            error
                        );
                    }).finally(() => {
                        setTimeout(() => {
                            sendFinalMenu(senderId);
                        }, 1000);
                    });
                    
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
                "Thank you for your confirmation. Please enter the One-time Password (OTP) send to your registered email address."
            );
            break;
        case "ask_if_billinquiry":
            if(answers.includes(message.toLowerCase().trim())){
                userSessions[senderId].step = "ask_account";
                sendMessage(senderId, "Thank you for your confirmation. Please provide your 8-digit account number.");
            }
            break;
        case "ask_if_power_interruption":
           if(answers.includes(message.toLowerCase().trim())){
                userSessions[senderId].step = "entire_home_without_power";
                userSessions[senderId].report_data = {};
                sendMessage(senderId, "Thank you for your confirmation. Is your entire home without power?");
            }
            break;
        case "entire_home_without_power":
            if(answers.includes(message.toLowerCase().trim())){
                userSessions[senderId].step = "neighbors_also_affected";
                userSessions[senderId].report_data.entire_home = true; 
                sendMessage(senderId, "Are your neighbors also affected?");
            }else{
                userSessions[senderId].report_data.entire_home = false; 
                sendMessage(senderId, "Please check your circuit breaker or fuse box before submitting the report.");
            }
            break;
        case "neighbors_also_affected":
            if(answers.includes(message.toLowerCase().trim())){
                userSessions[senderId].report_data.neighbors_affected = true; 
                userSessions[senderId].step = "enter_municipality";
                sendMunicipalityMenu(senderId);
            }else{
                userSessions[senderId].report_data.neighbors_affected = false; 
            }
            break;
        case "enter_municipality":
            const foundMunicipality = municipalities.filter(mun => mun.name.toLowerCase() == message.toLowerCase())
            if(foundMunicipality){
                userSessions[senderId].report_data.municipality_name = foundMunicipality[0].name;
                userSessions[senderId].report_data.municipality_code = foundMunicipality[0].geo_code;
                userSessions[senderId].step = "enter_barangay";
                barangays = psgcData.filter(psgc => psgc.geo_code.startsWith(userSessions[senderId].report_data.municipality_code.substring(0, 6)) && psgc.geo_level == 'Bgy')
                
                const quickReplies = getQuickReplies(barangays);
                sendBarangayMenu(senderId,quickReplies);
            }else{
                sendMessage(senderId, "Municipality not found.");
            }
            break;
        case "enter_barangay":
            const foundBarangay = barangays.filter(mun => mun.name.toLowerCase() == message.toLowerCase())
            
            break;
        default:
            // sendMessage(senderId, 'I\'m not sure what you need. Please start again.');
            sendMainMenu(senderId);
            break;
    }
}
// function requestLocation(senderId) {
//     const messageData = {
//         recipient: { id: senderId },
//         message: {
//             attachment: {
//                 type: 'template',
//                 payload: {
//                     template_type: 'button',
//                     text: 'SHARE MY LOCATION',
//                     buttons: [{ type: 'location' }]
//                 }
//             }
//         }
//     };

//     axios.post(`https://graph.facebook.com/v3.3/me/messages?fields=location&access_token=${process.env.PAGE_ACCESS_TOKEN}`, messageData)
//         .then(response => {
//             console.log('Request Location sent:', response.data);
//         })
//         .catch(error => {
//             console.error('Error requesting location:', error);
//         });
// }
function sendConfirmationMessage(senderId, lat, long) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            text: `Location received: Latitude - ${lat}, Longitude - ${long}`
        }
    };

    axios.post(`https://graph.facebook.com/v15.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, messageData)
        .then(response => {
            console.log('Confirmation sent:', response.data);
        })
        .catch(error => {
            console.error('Error sending confirmation:', error);
        });
}

function handleLocation(senderId, locationData) {
     // You can use these coordinates for processing
     console.log(`Received location from user ${senderId}: Latitude - ${lat}, Longitude - ${long}`);

     // Send confirmation message
     sendConfirmationMessage(senderId, lat, long);
    // Further processing of location data
}

async function getUserProfile(senderId) {
    try {
      const response = await axios.get(`https://graph.facebook.com/v16.0/${senderId}`, {
        params: {
          fields: 'first_name',
          access_token: process.env.PAGE_ACCESS_TOKEN
        }
      });
      return response.data; // Contains first_name and last_name
    } catch (error) {
      console.error('Error fetching user profile:', error.response.data);
      return null;
    }
  }
// Function to send the main menu with Bill Inquiry option
async function sendMainMenu(senderId) {

    const user = await getUserProfile(senderId);
    const first_name = user ? user.first_name : '';

    const messageData = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: `Hi ${first_name}! How can I assist you today?`,
                    buttons: [{
                            type: "postback",
                            title: "Bills & Payments",
                            payload: "BILLS_PAYMENTS",
                        },
                        {
                            type: "postback",
                            title: "Brownout or Incident",
                            payload: "REPORT_AN_OUTAGE",
                        },
                        {
                            type: "postback",
                            title: "Account Concern",
                            payload: "ACCOUNT_CONCERN",
                        },
                    ],
                },
            },
        },
    };
    callSendAPI(messageData)
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

    callSendAPI(messageData);
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

    callSendAPI(messageData);
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
                    text: `Where do you want to receive your One-Time Password (OTP)? `,
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

    callSendAPI(messageData);
}

// Function to send OTP message
function sendOTP(senderId, contactMethod) {
    const otp = Math.floor(100000 + Math.random() * 900000); // Generate a 6-digit OTP
    otps[senderId] = { otp, timestamp: Date.now() };

    userSessions[senderId].lastContactMethod = contactMethod; // Store contact method for resending

    // const contactMethodText = contactMethod.toLowerCase();

    const content = `Your One-Time Password (OTP) is ${otp}.\n\nPlease use this OTP to complete your verification process. Do not share this code with anyone.\nThank you.`;
    sendEmail("lhaicloud123@gmail.com", "CASURECO 1 OTP", content);

    // const messageData = {
    //     recipient: { id: senderId },
    //     message: {
    //         text: `Your OTP is ${otp}. Please enter it to verify. OTP has been sent to your ${contactMethodText}.`
    //     }
    // };

    // axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, messageData)
    // .then(response => {
    //     console.log('OTP sent:', response.data);
    // })
    // .catch(error => {
    //     console.error('Error sending OTP:', error);
    // });
}


async function getBalance(senderId){
    const cfcodeno = userSessions[senderId].account.cfcodeno

    try {
        const response = await axios.get(
            `https://casureco1api.com/billinquiry/getBalance`, {
                params: { account: cfcodeno },
                headers: {
                    Authorization: `Bearer ${process.env.API_KEY}`, // Authorization Bearer Token
                },
            }
        );
        return response.data
    } catch (error) {
        console.error("Error:", error.message);
        return false; // Return false in case of an error
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
                            title: "YES",
                            payload: "YES_ANOTHER_CONCERN",
                        },
                        {
                            type: "postback",
                            title: "NO",
                            payload: "END_CHAT",
                        },
                    ],
                },
            },
        },
    };

    callSendAPI(messageData);
}

function endChat(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            text: "Chat has ended. If you have any further questions, feel free to reach out anytime. Have a great day!",
        },
    };

    callSendAPI(messageData);
}

function hasMaxAttempts(){
    var isMax = false
    if(userSessions[senderId].attempts >= max_attempts && Date.now() - userSessions[senderId].max_attempt_time > 5 * 60 * 1000){ 
        userSessions[senderId].attempts = 0;
        delete userSessions[senderId].max_attempt_time;
    }
    if(userSessions[senderId].attempts >= max_attempts){
        sendMessage(senderId, "You have exceeded the maximum number of attempts. Please try again after 5 minutes.");
        userSessions[senderId].max_attempt_time = userSessions[senderId].max_attempt_time ? userSessions[senderId].max_attempt_time : Date.now(); //
        userSessions[senderId].step = 'main_menu';
        isMax = true
    }
    return isMax
}
// Function to validate account number (replace with actual logic)
async function validateAccountNumber(accountNumber, senderId) {
    const cleanedAccountNumber = accountNumber.replace(/[^0-9]/g, ""); // Keeps only digits
    if(hasMaxAttempts)
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
// Function to validate account number (replace with actual logic)
async function validateAccountName(accountName, senderId) {
    const masterAccountName = userSessions[senderId].account.cflastname+', '+userSessions[senderId].account.cffirstnam;
    const similarityScore = fuzz.ratio(masterAccountName, accountName);
    return similarityScore >= 80;
}

// Function to send a message via the Messenger API
function sendMessage(senderId, messageText) {
    const messageData = {
        recipient: { id: senderId },
        message: { text: messageText },
    };

    callSendAPI(messageData);
}

function sendMessageWithImage(senderId, image_url = '') {
    const messageData = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "generic",
                    elements: [{
                        image_url: image_url,
                    }, ],
                },
            },
        },
    };

    callSendAPI(messageData);
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

function sendMunicipalityMenu(senderId) {
    
    const quickReplies = municipalities.map(municipality => {
        return {
            content_type: "text",
            title: municipality.name,
            payload: municipality.name.toUpperCase() // Convert spaces to underscores and make it uppercase for payload
        };
    });

    const messageData = {
        recipient: { id: senderId },
        message: {
            "text": "Please choose or enter municipality",
            quick_replies: quickReplies
        },
    };

    callSendAPI(messageData);
}
function getQuickReplies(data, startIndex = 0, limit = 12) {
    // Get items between `startIndex` and `startIndex + limit`
    const slicedItems = data.slice(startIndex, startIndex + limit);

    // Map to Quick Reply format
    const quickReplies = slicedItems.map((item) => ({
        content_type: "text",
        title: item.name,
        payload: item.name.toUpperCase()
    }));

    // Add a "Load More" button if there are more items left
    if (startIndex + limit < data.length) {
        quickReplies.push({
            content_type: "text",
            title: "Load More",
            payload: `LOAD_MORE_${startIndex + limit}`
        });
    }

    return quickReplies;
}
function sendBarangayMenu(senderId,quickReplies) {
    
    const messageData = {
        recipient: { id: senderId },
        message: {
            "text": "Please choose or enter barangay",
            quick_replies: quickReplies
        },
    };

    callSendAPI(messageData);
}

const PORT = 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));