const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = 'EAAGizoa2IFwBO63KQWgiZA1MdrnarUo8iEsOn1WS4hlpyoSRZCNS5ok9cEcxekdFVyH1ZAblGg7a5CrSYG967IxZB1jahELmoxNQq1b77PaYrTk9DTCPeq5Rm8JqGj6PBgJJ7ETmphqlA2fJixMKMEKZCQQ6QO9m64vsgqWGmsbNH6oFKybELCZCZBCSWmlNtcs3AZDZD';

// Webhook verification
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('Webhook verified!');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Webhook for handling messages
app.post('/webhook', (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(entry => {
            const webhookEvent = entry.messaging[0];
            console.log(webhookEvent);

            // Handle the received message
            if (webhookEvent.message) {
                handleMessage(webhookEvent);
            }
        });

        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

function handleMessage(event) {
    const senderId = event.sender.id;
    const message = event.message.text;

    // Logic for replying to messages
    console.log(`Message from ${senderId}: ${message}`);
}

const PORT = 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
