let path = require('path')
let fs = require('fs')
let net = require('net')
let jsonsocket = require('json-socket')
let rimraf = require('rimraf')
let mkdirp = require('mkdirp')
let argv = require('yargs').argv

require('songbird')

const ROOT_DIR = argv.dir || path.resolve(process.cwd())

let TCP_PORT = process.env.TCP_PORT || 8001
let HOST = process.env.HOST || '127.0.0.1'

let socket = new jsonsocket(new net.Socket());
socket.connect(TCP_PORT, HOST)
socket.on('connect', () => { 
    socket.on('message', (packet) => {
        async ()=> {

        	if (!packet || !packet.action || !packet.path || !packet.type) {
				return
			}

			console.log('Packet received: ', packet)
        	
        	await setFileMeta(packet)
        	await setDirDetails(packet)

        	console.log('Derived filePath: ', packet.filePath)

	        if (packet.action === 'delete') {
	        	console.log('inside delete')
	        	if (!packet.stat) {
					return
				} 
				if (packet.stat.isDirectory()) {
					await rimraf.promise(packet.filePath)
				} else {
					await fs.promise.unlink(packet.filePath)
				}
	        } else if (packet.action === 'create') {
	        	console.log('inside create')
	        	if (packet.stat) {
					return
				}

				await mkdirp.promise(packet.dirPath)

				if(!packet.isDir && packet.contents) {
					await fs.writeFile(packet.filePath, packet.contents, 'utf-8')
				}
	        } else if (packet.action === 'update' && packet.contents) {
	        	console.log('inside update')
	        	if (!packet.stat || packet.isDir) {
					return
				}

				await fs.promise.truncate(packet.filePath, 0)
				await fs.writeFile(packet.filePath, packet.contents, 'utf-8')

	        }
        }().catch(() => {})
        
    });
});

async function setFileMeta(packet) {
	packet.filePath = path.resolve(path.join(ROOT_DIR, packet.path))
	if (packet.filePath.indexOf(ROOT_DIR) !== 0) {
		return
	}
	console.log("derived filePath:", packet.filePath)
	await fs.promise.stat(packet.filePath)
		.then(stat => packet.stat = stat, ()=> packet.stat = null)
}

function setDirDetails(packet) {
	let filePath = packet.filePath
	let endWithSlash = filePath.charAt(filePath.length - 1) === path.sep
	let hasExt = path.extname(filePath) !== ''
	packet.isDir = endWithSlash || !hasExt
	packet.dirPath = packet.isDir ? filePath : path.dirname(filePath)
}
