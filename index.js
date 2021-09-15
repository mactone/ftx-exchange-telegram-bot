'use strict'
require('dotenv').config()
const { Telegraf, session, Scenes: { BaseScene, Stage } } = require('telegraf')
const lendingRates = require('./src/ftx/lendingRates')
const lending = require('./src/ftx/lending')
const wallet = require('./src/ftx/wallet')
const ftxDB = require('./src/ftx/database')
const filePath = "./database.json"
const file = require(filePath)
const fs = require('fs')
const _ = require('lodash')

//watch list scene
const watchListScene = new BaseScene('watchListScene')
const watchHelp = `List of available commands: 
/list - List of coins available on FTX
/update - Update local database
/current - Display current watchlist
/add <coin> - Add coin to your watchlist
/remove <coin> - Remove coin from your watchlist
/back - Return to main menu\n`
watchListScene.enter(ctx => ctx.reply(`Welcome to watch tower\n ${watchHelp}`))
watchListScene.help((ctx) => ctx.reply(watchHelp))
watchListScene.command('list', ctx => {
    let message = `Last updated: ${new Date(file['lastUpdated'])} \n`;
    let arrayOfSupportedCoins = file['db']
    arrayOfSupportedCoins.forEach(coin => {
        message += `[${coin.id}] - ${coin.name} \n`
    })
    ctx.reply(message)
})
watchListScene.command('update', async ctx => {
    let coinsJSON = await ftxDB.getLendingCoinDatabase()
    file['db'] = coinsJSON
    file['lastUpdated'] = Date.now()
    save(file)
    ctx.reply('Updated database')
})
watchListScene.command('current', ctx => {
    let list = ``
    file.watchlist.forEach(coin => {
        list += `${coin}\n`
    })
    ctx.reply(list)
})
watchListScene.command('add', ctx => {
    let value = ctx.message.text.split(" ")
    let coin = value[1].toUpperCase()
    file.watchlist.push(coin)
    save(file)
    ctx.reply(`Added ${coin}`)
})
watchListScene.command('remove', ctx => {
    let value = ctx.message.text.split(" ")
    let coin = value[1].toUpperCase()
    const index = file.watchlist.indexOf(coin)
    if (index === -1) {
        ctx.reply(`${coin} is not in the list`)
        return
    }
    file.watchlist.splice(index, 1)
    save(file)
    ctx.reply(`Removed ${coin}`)
})
watchListScene.command('back', ctx => { return ctx.scene.leave() })
watchListScene.leave(ctx => ctx.reply('Leaving watch tower'))

//lending scene
const lendingScene = new BaseScene('lendingScene')
const lendingHelp = `List of available commands: 
/top10 - Top 10 estimated rates for the next hour
/top10crypto - Top 10 crypto estimated rates for the next hour
/watchlist - Your watchlist estimated rates for the next hour
/add <coin> - Add coin to your lending list
/remove <coin> - Remove coin from your lending list
/back - Return to main menu\n`
lendingScene.enter(ctx => ctx.reply(`Welcome to lending\n ${lendingHelp}`))
lendingScene.help(ctx => ctx.reply(lendingHelp))
lendingScene.command('top10', ctx => {
    getTop10Rates(ctx)
})
lendingScene.command('top10crypto', ctx => {
    getTop10CryptoRates(ctx)
})
lendingScene.command('watchlist', ctx => {
    getWatchListRates(ctx)
})
lendingScene.command('back', ctx => { return ctx.scene.leave() })
lendingScene.leave(ctx => ctx.reply('Leaving lending scene'))

//Initiate Telegram Bot
const stage = new Stage([watchListScene, lendingScene])
const bot = new Telegraf(process.env.BOT_TOKEN)
bot.use(session())
bot.use(stage.middleware())
bot.help((ctx) => getHelp(ctx))
bot.command('start', ctx => startLending(ctx))
bot.command('balance', ctx => getBalance(ctx))
bot.command('watchlist', ctx => ctx.scene.enter('watchListScene'))
bot.command('lending', ctx => ctx.scene.enter('lendingScene'))
bot.command('whois', ctx => whois(ctx))
bot.command('stop', ctx => stopLending(ctx))
bot.launch()

async function startLending(ctx) {
    lending.start()
    ctx.reply('Start lending')
}

function stopLending(ctx) {
    lending.stop()
    ctx.reply('Stopping lending')
}

function whois(ctx) {
    const value = ctx.message.text.split(" ")
    const coin = value[1]?.toUpperCase()
    let result = `Missing coin ticker symbol`
    if(coin){
        const doc = _.find(file.db, o => { return o.id === coin })
        result = (doc) ? doc.name : `${coin} does not exist in the database, please try to update in /watchlist`
    }
    ctx.reply(`${result}`)
}

async function getBalance(ctx) {
    let arrayOfBalance = await wallet.getBalances()
    let msg = generateBalanceSheet(arrayOfBalance)
    ctx.reply(msg)
}

function getHelp(ctx) {
    const help = `List of commands:\n/watchlist - Enter watchlist scene\n/lending - Enter lending scene\n/whois <coin> - Check the full name of the coin\n/start - Start auto-compounding\n/stop - Stop lending`
    ctx.reply(help)
}

async function getWatchListRates(ctx) {
    try {
        const results = await lendingRates.getRatesByWatchlist(file.watchlist)
        const message = generateRatesMsg(results)
        ctx.reply(message)
    } catch (error) {
        console.log(`Error: ${error}`)
    }
}

async function getTop10Rates(ctx) {
    try {
        const results = await lendingRates.getAllRates(10)
        const message = generateRatesMsg(results)
        ctx.reply(message)
    } catch (error) {
        console.log(`Error: ${error}`)
    }
}

async function getTop10CryptoRates(ctx) {
    try {
        const results = await lendingRates.getCryptoRates(10)
        const message = generateRatesMsg(results)
        ctx.reply(message)
    } catch (error) {
        console.log(`Error: ${error}`)
    }
}

function generateRatesMsg(results = []) {
    let message = ``
    results.forEach(result => {
        if (!result) return
        let estimate = parseFloat(result.estimate * 24 * 365 * 100).toFixed(2) + "%"
        message += `[${result.coin}] Estimate: ${estimate} \n`
    })
    return message
}

function generateBalanceSheet(arrayOfBalance) {
    let message = `Balances: \n`
    let counter = 0
    arrayOfBalance.forEach(balance => {
        if(balance.total === 0) return
        counter++
        message += `[${balance.coin}] Total: ${balance.total}, Value: USD$${balance.usdValue.toFixed(2)} \n`
    })
    return (counter === 0) ? `No balances` : message
}

function save(newFile) {
    fs.writeFile(filePath, JSON.stringify(newFile), (err) => {
        if (err) return console.log(err)
        console.log(`Successfully saved database.json`)
    })
}

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))