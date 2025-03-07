import express, { response } from "express";
import bodyParser from "body-parser";
import axios from "axios";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from 'dotenv';
import { categorizeMessage } from './categorize.js';
const fuzz = await import('fuzzball');
import fs from 'fs';
import { insertUserSession, getUserWithAccounts, getUsers, markPrivacyPolicySeen, markPrivacyPolicyAgree, saveAccount  } from './db.js';

// import { insertUserSession, getUserWithAccounts, getAllSessions, markPrivacyPolicySeen, markPrivacyPolicyAgree ,deleteUserSession, deleteTable, saveAccount } from './sqlite.js';

console.log(await getUsers());

// getAllSessions((user) => {
//     console.log(user)
// })

const max_attempts = 5
const max_accounts = 3
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
let userReports = {};
// Temporary storage for OTP generation (to simulate OTP validation)
let otps = {};

const answers = ['yes','oo','opo','yeah','yep','yup','sure','okay','alright','absolutely','of course','correct','right'];
var psgcData = []
var municipalities = []
var barangays = []
const brownout_options = [
    {
        text: "No Power (Entire Home)", 
        value: "A"
    },
    {
        text: "No Power (Entire Street/Block)", 
        value: "B"
    },
    {
        text: "Unstable Power" , 
        value: "C"
    },
    {
        text: "Streetlight Concern", 
        value: "D"
    },
    {
        text: "Safety Concern (e.g., wires down, exposed cables)",
        value: "E"
    },
]

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
                (async () => {
                    // console.log(webhookEvent);
                    // console.log(userSessions[senderId])

                    // Ensure user session exists, initialize if not
                    if (!userSessions[senderId]) {
                        var userData = await getUserWithAccounts(senderId);

                        if(!userData){
                            await insertUserSession(senderId);
                            userData = await getUserWithAccounts(senderId);
                        }
                        userSessions[senderId] = userData;
                    }
                    
                    const user = await getUserProfile(senderId);
                    userSessions[senderId].first_name = user ? user.first_name : '';
                    const userName = user ? user.name : '';
                    const userID = user ? user.id : '';
                    if(!userSessions[senderId].brownout_details){
                        userSessions[senderId].brownout_details = { name : userName, id : userID }
                    }
                    
                    // console.log(userSessions[senderId])

                    // Check if it's a postback (e.g., from a button click or quick reply)
                    if (webhookEvent.postback) {
                        var postbackPayload = webhookEvent.postback.payload;
                        console.log("Postback received:", postbackPayload);
                        if(postbackPayload == "PROCEED"){
                            userSessions[senderId].privacyPolicyAgree = 1;
                            postbackPayload = userSessions[senderId].lastPostBack
                            await markPrivacyPolicyAgree(senderId);
                        }
                        if(!userSessions[senderId].privacyPolicyAgree){
                            showPrivacyPolicy(senderId);
                            userSessions[senderId].lastPostBack = postbackPayload;
                            return;
                        }

                        handlePostback(senderId, postbackPayload);

                        // If user has not seen privacy policy yet, show it
                        // if (!userSessions[senderId].privacyPolicySeen) {
                        //     showPrivacyPolicy(senderId); // Show privacy policy
                        //     userSessions[senderId].privacyPolicySeen = true; // Mark privacy policy as seen
                        // } else {
                        //     // Handle postback (e.g., Proceed button clicked)
                        //     if (postbackPayload === "PROCEED") {
                        //         // Set the user's step to show the main menu
                        //         userSessions[senderId].step = "main_menu"; 
                        //         sendMainMenu(senderId); // Show main menu
                        //     } else {
                        //         // Handle other postbacks here
                        //         handlePostback(senderId, postbackPayload); // Handle other types of postbacks
                        //     }
                        // }
                        
                        
                    }else if(webhookEvent.message && webhookEvent.message.quick_reply){ // Check if it's a quick message
                        const payload = webhookEvent.message.quick_reply.payload;
                        console.log(payload)
                        console.log(userSessions[senderId])
                        if(payload.startsWith('account_')){
                            const cfcodeno = payload.split("_")[1];
                            const selectedAccount = userSessions[senderId].accounts.filter( acc => acc.cfcodeno == cfcodeno)[0];
                            userSessions[senderId].account = selectedAccount
                            showBalanceOrPayment(senderId);
                            return;
                        }
                        if(userSessions[senderId].step == 'provide_brownout_mobile'){
                            var mobile = payload
                            if (mobile.startsWith("+63")) {
                                mobile = "0" + mobile.slice(3);
                            }else if (mobile.startsWith("63")) {
                                mobile = "0" + mobile.slice(2);
                            }
                            userSessions[senderId].brownout_details.mobile = mobile
                            if(!userSessions[senderId].brownout_details.message){
                                userSessions[senderId].step = "provide_brownout_message";
                                sendMessage(senderId,"Please enter your message");
                            }else{
                                sendBrownoutReportSummary(senderId);
                                setTimeout(() => {
                                    sendFinalMenu(senderId);
                                }, 1000);
                            }
                        }
                    }
                    // Check if it's a text message
                    else if (webhookEvent.message && webhookEvent.message.text) {
                        console.log("Text received:", webhookEvent.message.text);
                        const tokens = preprocessMessage(webhookEvent.message.text);
                        const category = categorizeMessage(tokens);
                        console.log(`Message categorized as: ${category}`);
                        if(category == 'power_interruption'){
                            userSessions[senderId].brownout_details.message = webhookEvent.message.text
                        }
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
                })();
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
                        type: "postback",
                        title: "Apply for New Connection",
                        payload: "APPLY_NEW_CONNECTION"
                    },
                    {
                        type: "web_url",
                        title: "Visit Website",
                        url: "https://casureco1.com",
                        webview_height_ratio: "full"
                    },
                    // {
                    //     type: "postback",
                    //     title: "Chat with an Agent",
                    //     payload: "CHAT_AGENT"
                    // },
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
async function showPrivacyPolicy(senderId){
    const messageTitle = "At CASURECO 1, we respect your privacy and are strongly committed to keeping secure any information we obtain from you or about you. We may access your Facebook profile and other personal data based on the services you use to improve your experience and keep your data private, unless required by law. Read our privacy policy to know more."
    
    await markPrivacyPolicySeen(senderId);
    userSessions[senderId].privacyPolicySeen = 1;

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
                        // {
                        //     type: "postback",
                        //     title: "Back to Previous Menu",
                        //     payload: "MAIN_MENU",
                        // },
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
        case "MAIN_MENU_OPTION_1":
            showBillorPayment(senderId);
            // userSessions[senderId].step = "ask_account";
            // sendMessage(senderId, "Please enter your 8-digit account number.");
            break;
        case "VIEW_BILLS_PAYMENTS":
            showBillorPayment(senderId);
            break;
        case "BILL_DETAILS":
            userSessions[senderId].bill = 1;
            userSessions[senderId].step = "ask_account";

            if(userSessions[senderId].accounts && userSessions[senderId].accounts.length > 0){
                showExistingAccount(senderId);
                break;
            }
            
            
            sendMessage(senderId, "Please enter your 8-digit account number.");
            break;
        case "PAYMENT_HISTORY":
            userSessions[senderId].step = "ask_account";
            userSessions[senderId].payment = 1;

            if(userSessions[senderId].accounts && userSessions[senderId].accounts.length > 0){
                showExistingAccount(senderId);
                break;
            }

            sendMessage(senderId, "Please enter your 8-digit account number.");
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
            sendMessage(senderId, "Chat has ended. If you have any further questions, feel free to reach out anytime. Have a great day!");
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
        case "BACK_TO_PREVIOUS_MENU2":
            userSessions[senderId].updating_information = false;
            userSessions[senderId].step = "ask_otp_method";
            sendOTPChoiceMenu(senderId);
            break; 
        case "MAIN_MENU_OPTION_2":
            (async () => { 
                const tickets = await getMyTickets(senderId);
                
                if(tickets && tickets.ticket_history.length > 0){
                    if (!userSessions[senderId].tickets) {
                        userSessions[senderId].tickets = {};
                    }
                    userSessions[senderId].tickets.ticket_history = tickets.ticket_history.map((t) => {
                        return {
                            ...t, 
                            status_text: getStatusText(t.status) 
                        };
                    });
                }
                if(tickets && tickets.pending_ticket.length > 0){
                    if (!userSessions[senderId].tickets) {
                        userSessions[senderId].tickets = {};
                    }
                    userSessions[senderId].tickets.pending_ticket = tickets.pending_ticket.map((t) => {
                        return {
                            ...t, 
                            status_text: getStatusText(t.status) 
                        };
                    });
                    sendViewMyActiveTicket(senderId);
                    return;
                }
                // userSessions[senderId].step = "report_or_follow_up";
                // sendReportOrFollowUp(senderId);
                userSessions[senderId].step = "provide_brownout_address";
                sendMessage(senderId, "Please provide the following details: \n\nSitio/Street/Zone\nBarangay\nMunicipality");
            })();
            
            // sendReportConfirmIssue(senderId);
            break;
        case "SAVE_ACCOUNT":
            (async () => {
                if(userSessions[senderId].accounts.length >= max_accounts){
                    sendMessage(senderId, "You cannot add more accounts. The limit has been reached.");
                    sendFinalMenu(senderId);
                }else{
                    saveAccount(senderId,userSessions[senderId].account);
                    userSessions[senderId] = await getUserWithAccounts(senderId);
                    sendFinalMenu(senderId);
                }
            })();
            break;
        case "DONT_SAVE":
            sendFinalMenu(senderId);
            break;
        case "REPORT_BROWNOUT_OPTION":
           
            // if(!userSessions[senderId].brownout_details){
            //     userSessions[senderId].brownout_details = { name : userSessions[senderId].name }
            // }else{
            //     userSessions[senderId].brownout_details.name = userSessions[senderId].name
            // }
            userSessions[senderId].step = "provide_brownout_address";
            sendMessage(senderId, "Please provide the following details: \n\nSitio/Street/Zone\nBarangay\nMunicipality");
            break;
        case "VIEW_ACTIVE_TICKET":
            const activeTicket = userSessions[senderId].tickets.pending_ticket[0]
            sendMessage(senderId, `Ticket No.: \nABC123\n\nContact Information: \n${activeTicket.name}\n${activeTicket.mobile}\n\nAddress: \n${activeTicket.address}\n\nMessage: \n${activeTicket.message}\n\nStatus: \n${activeTicket.status_text}`);
            break;
        case "VIEW_TICKET_HISTORY":
            const ticketHistory = userSessions[senderId].tickets.ticket_history
            if(ticketHistory && ticketHistory.length > 0){
                ticketHistory.slice(0, 3).forEach(history => {
                    sendMessage(senderId, `Ticket No.: \nABC123\n\nContact Information: \n${history.name}\n${history.mobile}\n\nAddress: \n${history.address}\n\nMessage: \n${history.message}\n\nStatus: \n${history.status_text}`);
                });
            }else{
                sendMessage(senderId,"No ticket history found")
            }
            
            break;
        default:
            if(!userSessions[senderId].step){
                sendMainMenu(senderId);
            }
            // sendMessage(senderId, "Sorry, I didn't understand that action.");
            break;
    }
}


// Handle user responses based on the step they are in
async function handleUserMessage(senderId, message,category) {
    // Ensure that the user session exists
    if (!userSessions[senderId].step) {
        userSessions[senderId] = { step: "main_menu" }; 
    }
    if (!userSessions[senderId].attempts) {
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
                        sendMessage(senderId, "Please enter your account name.");
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
                   
                    showBalanceOrPayment(senderId);
                    // getBalance(senderId)
                    // .then((data) => {
                    //     const unPaidBills = data.filter((item) => item.paid == 'No')
                    //     const payments = data.filter((item) => item.paid == 'Yes')
                    //     if(unPaidBills && unPaidBills.length > 0 && userSessions[senderId].bill){
                    //         content = `Your unpaid power bill(s): \n\n`
                    //         unPaidBills.forEach(bill => {
                    //             var formatted_date = new Date(bill.dfdue).toLocaleDateString("en-US")
                    //             content += `Bill Month: ${bill.billmo} ${bill.billyear}\nAmount Due: PHP ${bill.total}\nDue Date: ${formatted_date} \n\n`
                    //         });
                    //         content += "Enjoy FAST, SECURE & HASSLE-FREE payments through mobile applications and collection centers that are within your reach like GCash, Maya, Land Bank, ECPay & Bayad Center Authorized Payment Partners. Click this link https://www.casureco1.com/#online-payment to see the list of authorized payment partners.\n\n If you already paid your bill, please ignore this message."
                    //     }else if(unPaidBills && unPaidBills.length == 0 && userSessions[senderId].bill){
                    //         content = "There are no unpaid power bills on record\n\nYou may view your bills and payments through CASURECO 1 Mobile Application. To download the app click the link https://bit.ly/42bvJ83.";
                    //     }

                    //     if(payments && payments.length > 0 && userSessions[senderId].payment){
                    //         content = `Your payment history for the last 3 months: \n\n`
                    //         payments.slice(0, 3).forEach(payment => {
                    //             var formatted_date = new Date(payment.dfpaid).toLocaleDateString("en-US")
                    //             content += `Bill Month: ${payment.billmo} ${payment.billyear}\nDate Paid: ${formatted_date}\nAmount Paid: PHP ${payment.total}\nReference No.: ${payment.cfreferenc} \n\n`
                    //         });
                    //     }else if(payments && payments.length == 0 && userSessions[senderId].payment){
                    //         content = "There are no payments on record\n\nYou may view your bills and payments through CASURECO 1 Mobile Application. To download the app click the link https://bit.ly/42bvJ83.";
                    //     }

                    //     sendMessage(senderId,content);
                    //     setTimeout(() => {
                    //         sendFinalMenu(senderId);
                    //     }, 1000);
                    //     // userSessions[senderId].step = 'done'
                    // })
                    // .catch((error) => {
                    //     content = "Error occurred while getting the balance"
                    //     sendMessage(senderId,content);
                    //     console.error(
                    //         "Error occurred while getting the balance:",
                    //         error
                    //     );
                    // })
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
                    showBalanceOrPayment(senderId);
                    // var content = ''
                    // getBalance(senderId)
                    // .then((data) => {
                    //     if(data && data.length > 0){
                    //         content = `Your unpaid power bill(s): \n\n`

                    //         data.forEach(bill => {
                    //             var formatted_date = new Date(bill.dfdue).toLocaleDateString("en-US")
                    //             content += `Bill Month: ${bill.billmo} ${bill.billyear}\nAmount Due: PHP ${bill.total}\nDue Date: ${formatted_date} \n\n`
                    //         });
                    //         content += "Enjoy FAST, SECURE & HASSLE-FREE payments through mobile applications and collection centers that are within your reach like GCash, Maya, Land Bank, ECPay & Bayad Center Authorized Payment Partners. Click this link https://www.casureco1.com/#online-payment to see the list of authorized payment partners.\n\n If you already paid your bill, please ignore this message."
                    //     }else{
                    //         content = "There are no unpaid power bills on record\n\nYou may view your bills and payments through CASURECO 1 Mobile Application. To download the app click the link https://bit.ly/42bvJ83.";
                    //     }
                    //     sendMessage(senderId,content);
                    // })
                    // .catch((error) => {
                    //     content = "Error occurred while getting the balance"
                    //     sendMessage(senderId,content);
                    //     console.error(
                    //         "Error occurred while getting the balance:",
                    //         error
                    //     );
                    // }).finally(() => {
                    //     setTimeout(() => {
                    //         sendFinalMenu(senderId);
                    //     }, 1000);
                    // });
                    
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
                sendMessage(senderId, "Thank you for your confirmation. Please enter your 8-digit account number.");
            }
            break;
        case "ask_if_power_interruption":
           if(answers.includes(message.toLowerCase().trim())){
                // userSessions[senderId].step = "entire_home_without_power";
                // userSessions[senderId].report_data = {};
                // sendMessage(senderId, "Thank you for your confirmation. Is your entire home without power?");
                // userSessions[senderId].step = "report_or_follow_up";
                // sendReportOrFollowUp(senderId);
                userSessions[senderId].step = "provide_brownout_address";
                sendMessage(senderId, "Please provide the following details: \n\nSitio/Street/Zone\nBarangay\nMunicipality");
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
        case "provide_brownout_address":
            console.log(message);
            const address = message.replace(/\n/g, ', ');
            userSessions[senderId].brownout_details.address = address
            userSessions[senderId].step = "provide_brownout_mobile";
            sendShareNumber(senderId);
            // sendMessage(senderId,"Please enter your mobile number");
            break;
        case "provide_brownout_mobile":
            
            if(!validateMobileNumber(message)){
                sendMessage(senderId,"Invalid Mobile Number. Please try again.");
                break;
            }
            userSessions[senderId].brownout_details.mobile = message
            if(!userSessions[senderId].brownout_details.message){
                sendMessage(senderId,"Please enter your message");
                userSessions[senderId].step = "provide_brownout_message";
            }
            console.log(userSessions[senderId].brownout_details);
            break;
        case "provide_brownout_message":
            userSessions[senderId].brownout_details.message = message
            console.log(userSessions[senderId].brownout_details);
            submitBrownoutReport(senderId);

            
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
          fields: 'first_name,name',
          access_token: process.env.PAGE_ACCESS_TOKEN
        }
      });
      return response.data; // Contains first_name and last_name
    } catch (error) {
      console.error('Error ing user profile:', error.response.data);
      return null;
    }
  }
// Function to send the main menu with Bill Inquiry option
async function sendMainMenu(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: `Hi ${userSessions[senderId].first_name}! How can I assist you today?`,
                    buttons: [{
                            type: "postback",
                            title: "Bills & Payments",
                            payload: "MAIN_MENU_OPTION_1",
                        },
                        {
                            type: "postback",
                            title: "Brownout",
                            payload: "MAIN_MENU_OPTION_2",
                        },
                        {
                            type: "postback",
                            title: "Account Concern",
                            payload: "MAIN_MENU_OPTION_3",
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
                            payload: "MAIN_MENU",
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
function showExistingAccount(senderId){
    // const accno = userSessions[senderId].account.cfrotcode + '-' + userSessions[senderId].account.cfacctno;

    const quickReplies = userSessions[senderId].accounts.map(account => {
        return {
            content_type: "text",
            title: account.cfrotcode+'-'+account.cfacctno,
            payload: "account_"+account.cfcodeno
        };
    });
    console.log(quickReplies);
    const messageData = {
        recipient: { id: senderId },
        message: {
            "text": "Please enter your 8-digit account number or select a saved account below",
            quick_replies: quickReplies
        },
    };

    callSendAPI(messageData);
}
function showBalanceOrPayment(senderId){
    var content = ''
    getBalance(senderId)
        .then((data) => {
            const unPaidBills = data.filter((item) => item.paid == 'No')
            const payments = data.filter((item) => item.paid == 'Yes')
            if(unPaidBills && unPaidBills.length > 0 && userSessions[senderId].bill){
                content = `Your unpaid power bill(s): \n\n`
                unPaidBills.forEach(bill => {
                    var formatted_date = new Date(bill.dfdue).toLocaleDateString("en-US")
                    content += `Bill Month: ${bill.billmo} ${bill.billyear}\nAmount Due: PHP ${bill.total}\nDue Date: ${formatted_date} \n\n`
                });
                content += "Enjoy FAST, SECURE & HASSLE-FREE payments through mobile applications and collection centers that are within your reach like GCash, Maya, Land Bank, ECPay & Bayad Center Authorized Payment Partners. Click this link https://www.casureco1.com/#online-payment to see the list of authorized payment partners.\n\n If you already paid your bill, please ignore this message."
            }else if(unPaidBills && unPaidBills.length == 0 && userSessions[senderId].bill){
                content = "There are no unpaid power bills on record\n\nYou may view your bills and payments through CASURECO 1 Mobile Application. To download the app click the link https://bit.ly/42bvJ83.";
            }

            if(payments && payments.length > 0 && userSessions[senderId].payment){
                content = `Your payment history for the last 3 months: \n\n`
                payments.slice(0, 3).forEach(payment => {
                    var formatted_date = new Date(payment.dfpaid).toLocaleDateString("en-US")
                    content += `Bill Month: ${payment.billmo} ${payment.billyear}\nDate Paid: ${formatted_date}\nAmount Paid: PHP ${payment.total}\nReference No.: ${payment.cfreferenc} \n\n`
                });
                content += "Enjoy FAST, SECURE & HASSLE-FREE payments through mobile applications and collection centers that are within your reach like GCash, Maya, Land Bank, ECPay & Bayad Center Authorized Payment Partners. Click this link https://www.casureco1.com/#online-payment to see the list of authorized payment partners.\n\n If you already paid your bill, please ignore this message."
            }else if(payments && payments.length == 0 && userSessions[senderId].payment){
                content = "There are no payments on record\n\nYou may view your bills and payments through CASURECO 1 Mobile Application. To download the app click the link https://bit.ly/42bvJ83.";
            }

            userSessions[senderId].bill = 0;
            userSessions[senderId].payment = 0;
            (async () => {
                await sendMessage(senderId,content);

                const account = userSessions[senderId].accounts.find(acc => acc.cfcodeno === userSessions[senderId].account.cfcodeno);
                if(!account || userSessions[senderId].accounts.length == 0){
                    setTimeout(() => {
                        sendSaveAccountForFutureUse(senderId);
                    }, 1000);
                }else{
                    setTimeout(() => {
                        sendFinalMenu(senderId);
                    }, 1000);
                }
            })();

            // userSessions[senderId].step = 'done'
        })
        .catch((error) => {
            content = "Error occurred while getting the balance"
            sendMessage(senderId,content);
            console.error(
                "Error occurred while getting the balance:",
                error
            );
        })
}
function sendSaveAccountForFutureUse(senderId){
    const messageData = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Do you want to save this account for future use?",
                    buttons: [{
                            type: "postback",
                            title: "Yes, Save it!",
                            payload: "SAVE_ACCOUNT",
                        },
                        {
                            type: "postback",
                            title: "No, Thank you.",
                            payload: "DONT_SAVE",
                        },
                    ],
                },
            },
        },
    };

    callSendAPI(messageData);
}
function sendReportOrFollowUp(senderId){
    const messageData = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Please choose from the options below:",
                    buttons: [{
                            type: "postback",
                            title: "Report A Brownout",
                            payload: "REPORT_BROWNOUT_OPTION",
                        },
                        {
                            type: "postback",
                            title: "Follow up My Report",
                            payload: "FOLLOW_UP_OPTION",
                        },
                        // {
                        //     type: "postback",
                        //     title: "Back to Previous Menu",
                        //     payload: "MAIN_MENU",
                        // },
                    ],
                },
            },
        },
    };

    callSendAPI(messageData);
}

function sendBrownoutOptions_bak(senderId){
    const quickReplies = brownout_options.map(option => {
        return {
            content_type: "text",
            title: option.value,
            payload: option.value // Convert spaces to underscores and make it uppercase for payload
        };
    });
    const txtOptions = brownout_options.map(option => {
        return `\n${option.value}. ${option.text}`;
    });

    const messageData = {
        recipient: { id: senderId },
        message: {
            "text": `Please from the options below: \n${txtOptions}`,
            quick_replies: quickReplies
        },
    };

    callSendAPI(messageData);
}
function sendBrownoutOptions(senderId){
    const quickReplies = brownout_options.map(option => {
        return {
            content_type: "text",
            title: option.value,
            payload: option.value // Convert spaces to underscores and make it uppercase for payload
        };
    });
    const txtOptions = brownout_options.map(option => {
        return `\n${option.value}. ${option.text}`;
    });

    const messageData = {
        recipient: { id: senderId },
        message: {
            "text": `Please from the options below: \n${txtOptions}`,
            quick_replies: quickReplies
        },
    };

    callSendAPI(messageData);
}
function sendShareNumber(senderId) {
    
    const messageData = {
        recipient: { id: senderId },
        message: {
            "text": "Please share your mobile number",
            quick_replies: [
                {
                    "content_type": "user_phone_number"
                }
            ]
        },
    };

    callSendAPI(messageData);
}

function submitBrownoutReport(senderId){
    const curr_datetime = new Date();
    const formData = {
        created_at: curr_datetime.toISOString(),
        name: userSessions[senderId].brownout_details.name,
        address: userSessions[senderId].brownout_details.address,
        mobile: userSessions[senderId].brownout_details.mobile,
        latitude: '',
        longitude: '',
        message: userSessions[senderId].brownout_details.message,
        uuid: userSessions[senderId].brownout_details.id.toString()
        // uuid: "1231234567"
    }

    axios.post(`${process.env.TICKET_API}/ticket/create`, formData)
        .then((response) => {
            if(response.status == 200){
                sendBrownoutReportSummary(senderId);
                setTimeout(() => {
                    sendFinalMenu(senderId);
                }, 1000);
            }
        })
        .catch((error) => {
            console.log(error.response)
            switch (error.response.status) {
                case 409:
                    sendMessage(senderId,error.response.data.detail);
                    break;
                default:
                    sendMessage(senderId,"There was an error occurred. Please try again");
                    break;
            }
            
        })

}

function sendBrownoutReportSummary(senderId){
    const summary_data = userSessions[senderId].brownout_details
    const messageText = `Thank you! Your brownout report has been submitted.\n\nHere is your summary report:\n\nContact Information: \n${summary_data.name}\n${summary_data.mobile}\n\nAddress: \n${summary_data.address}\n\nMessage: \n${summary_data.message}\n\nTicket No. \nABC20250307`;
    const messageData = {
        recipient: { id: senderId },
        message: { text: messageText },
    };

    callSendAPI(messageData);
}

async function getMyTickets(senderId) {
    try {
        const response = await axios.get(`${process.env.TICKET_API}/ticket/get_my_ticket/${senderId}`);
        console.log(response.data)
        return response.data; 
    } catch (error) {
        console.error(error.response);
        return false;  
    }
}

function sendViewMyActiveTicket(senderId) {
    const messageData = {
        recipient: { id: senderId },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "You have an active ticket. Click here to view the details.",
                    buttons: [{
                            type: "postback",
                            title: "View Active Ticket",
                            payload: "VIEW_ACTIVE_TICKET",
                        },
                        {
                            type: "postback",
                            title: "View Ticket History",
                            payload: "VIEW_TICKET_HISTORY",
                        }
                    ],
                },
            },
        },
    };

    callSendAPI(messageData);
}
function getStatusText(status) {
    switch (status) {
        case 0: return "OPEN";
        case 1: return "ACKNOWLEDGE";
        case 2: return "TROUBLESHOOTING";
        case 3: return "RESOLVED";
        case 4: return "CLOSED";
        default: return "UNKNOWN";
    }
}

function validateMobileNumber(mobile) {
    // Remove spaces and dashes (optional formatting characters)
    mobile = mobile.replace(/[\s-+]/g, "");
    // Convert +63 to 0 if it starts with +63
    if (mobile.startsWith("63")) {
        mobile = "0" + mobile.slice(2);
    }
    // Validate that it follows the 11-digit PH mobile format
    const regex = /^09\d{9}$/;
    return regex.test(mobile) ? true : false;
}

const PORT = 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));