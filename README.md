# Telegram Bot for Grok

This is a Telegram bot that interacts with the Grok API to provide chat functionalities. The bot can handle text messages, photos, and media groups, and it maintains a chat context for each user.

## Features

- Handles text messages and photos
- Maintains chat context for each user
- Allows users to view the current chat context
- Allows users to change their role
- Logs chat messages to files

## Setup

1. Clone the repository:
    ```sh
    git clone https://github.com/yourusername/TelegramBotForGrok.git
    cd TelegramBotForGrok
    ```

2. Install dependencies:
    ```sh
    npm install
    ```

3. Create a `.env` file in the root directory and add your Telegram bot token and Grok API endpoint:
    ```env
    TELEGRAM_BOT_TOKEN=your_telegram_bot_token
    GROK_API_KEY ()
    GROK_API_ENDPOINT=https://api.x.ai/v1/chat/completions
    ```

4. Run the bot:
    ```sh
    node grok.js
    ```

## Usage

- Start the bot by sending the `/start` command.
- Use the buttons to view the current chat context or change your role.
- Send text messages or photos to interact with the bot.

## License

This project is licensed under the MIT License.