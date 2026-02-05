const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');

const app = express();
app.use(bodyParser.json());

app.post('/run', (req, res) => {
    const { command, args } = req.body;
    exec(`${command} ${args || ''}`, (err, stdout, stderr) => {
        if (err) return res.status(500).send(stderr);
        res.send(stdout);
    });
});

app.post('/read', (req, res) => {
    const { filePath } = req.body;
    res.type('text');
    res.sendFile(filePath);
});

app.post('/generate', (req, res) => {
    const { prompt } = req.body;
    res.type('text');
    res.send(prompt);
});

app.post('/analyze', (req, res) => {
    const { filePath, instruction } = req.body;
    res.type('text');
    res.send(`Análise de ${filePath}: ${instruction}`);
});

app.listen(11434, () => {
    console.log('Server running at http://localhost:11434');
});
