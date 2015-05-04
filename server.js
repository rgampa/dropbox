let express = require('express')
let path = require('path')
let morgan = require('morgan')
let nodeify = require('bluebird-nodeify')
let fs = require('fs')
let mime = require('mime-types')
let rimraf = require('rimraf')
let mkdirp = require('mkdirp')
let argv = require('yargs').argv
let net = require('net')
let jsonsocket = require('json-socket')

require('songbird')

const NODE_ENV = process.env.NODE_ENV
const PORT = process.env.PORT || 8000
const TCP_PORT = process.env.TCP_PORT || 8001
const ROOT_DIR = argv.dir || path.resolve(process.cwd())

let app = express()
let tcp = net.createServer()
let clients = [];

if (NODE_ENV === 'development') {
	app.use(morgan('dev'))
}

app.listen(PORT, ()=> console.log(`LISTENING @ http://127.0.0.0:${PORT}`))
tcp.listen(TCP_PORT)

tcp.on('connection', (socket) => {
	console.log('new client connected')
	clients.push(socket);
})

app.get('*', setFileMeta, sendHeaders, (req, res) => {
		if (res.body) {
			res.json(res.body)
			return
		}
		
		fs.createReadStream(req.filePath).pipe(res)	
})

app.head('*', setFileMeta, sendHeaders, (req, res) => res.end())

app.delete('*', setFileMeta, (req, res, next) => {
	async ()=> {
		if (!req.stat) {
			return res.send(400, 'Invalid path')
		} 
		if (req.stat.isDirectory()) {
			await rimraf.promise(req.filePath)
		} else {
			await fs.promise.unlink(req.filePath)
		}
		req.action = 'delete'
		res.end()
		next()
	}().catch(next)
}, syncClients)

app.put('*', setFileMeta, setDirDetails, (req, res, next) => {
	async ()=> {
		if (req.stat) {
			return res.send(405, 'File exists')
		}

		await mkdirp.promise(req.dirPath)

		if(!req.isDir) {
			req.pipe(fs.createWriteStream(req.filePath))
		}
		req.action = 'create'
		res.end()
		next()
	}().catch(next)	
}, syncClients)

app.post('*', setFileMeta, setDirDetails, (req, res, next) => {
	async ()=> {

		if (!req.stat) {
			return res.send(405, 'File does not exists')
		}

		if (req.isDir) {
			return res.send(405, 'Path is a directory')
		}

		await fs.promise.truncate(req.filePath, 0)
		req.pipe(fs.createWriteStream(req.filePath))
		req.action = 'update'
		res.end()
		next()
	}().catch(next)	
}, syncClients)

function syncClients(req, res, next) {
	async ()=> {

		if (clients.length === 0) {
			next()
		}
		
		let contents = null
		let fileType = null

		if (req.action !== 'delete') {
			await fs.promise.readFile(req.filePath, 'utf-8')
      			.then((fileContent) => {
        			contents = fileContent
      			})
		}
		
		if (req.stat) {
			fileType = req.stat.isDirectory() ? 'dir': 'file'
		} else {
			fileType = req.isDir ? 'dir' : 'file'
		}

		let packet = {
			action: req.action,
			path: req.url,
			type: fileType,
			contents: contents,
			updated: Date.now()
		}
		
		console.log("Packet sent:", packet)
		
		for (let i = 0; i < clients.length; i++) {
			let socket = new jsonsocket(clients[i])
			await socket.sendMessage(packet)
		}

		next()
	}().catch(next)		
}

function setDirDetails(req, res, next) {
	let filePath = req.filePath
	let endWithSlash = filePath.charAt(filePath.length - 1) === path.sep
	let hasExt = path.extname(filePath) !== ''
	req.isDir = endWithSlash || !hasExt
	req.dirPath = req.isDir ? filePath : path.dirname(filePath)
	next()
}

function sendHeaders(req, res, next) {
	nodeify(async ()=> {
		if (req.stat && req.stat.isDirectory()) {
			let files = await fs.promise.readdir(req.filePath)
			res.body = JSON.stringify(files)
			res.setHeader('Content-Length', res.body.length)
			res.setHeader('Content-Type', 'application/json')
			return
		}

		res.setHeader('Content-Length', req.stat.size)
		let contentType = mime.contentType(path.extname(req.filePath))
		res.setHeader('Content-Type', contentType)
	}(), next)	
}

function setFileMeta(req, res, next) {
	req.filePath = path.resolve(path.join(ROOT_DIR, req.url))
	if (req.filePath.indexOf(ROOT_DIR) !== 0) {
			res.send(400, 'Invalid path')
			return
	}

	fs.promise.stat(req.filePath)
		.then(stat => req.stat = stat, ()=> req.stat = null)
		.nodeify(next)
}
