var _ = require('lodash');
var http = require('http');
var async = require('async');
var log = require('npmlog');
var crypto = require('crypto');
var httpProxy = require('http-proxy');
var NodeList = require('./NodeList.js');

var BUFFER_ROBOTSTXT = new Buffer('User-agent: *\nDisallow: /\n', 'utf8');
var REGEX_NODES = /^\/nodes\//;

log.heading = 'tilestrata-balancer';
log.prefixStyle = {fg: 'grey'}
log.maxRecordSize = 100;

function Balancer(options) {
	var defaults = {
		port: 8080,
		privatePort: 8081,
		checkInterval: 5000,
		hostname: '0.0.0.0',
		unhealthyCount: 1,
		hashringCacheSize: 5000
	};

	this.token = crypto.randomBytes(64).toString('hex');
	this.options = _.extend(defaults, options);

	this.proxy = httpProxy.createProxyServer();
	this.proxy.on('error', function(err, req, res) {
		if (err.code !== 'ECONNRESET' && err.code !== 'ETIMEDOUT') {
			log.error('proxy', 'http://' + req.headers.host + req.url + ' failed (' + err.code + ': ' + err.message + ')');
		}
		try {
			res.writeHead(502, {'Content-Type': 'text/plain'});
			res.end(err.message);
		} catch (e) {}
	});

	this.nodes = new NodeList(this.token, this.options);

	// to prevent un-necessary stringification every time a node joins
	this.register_body = new Buffer(JSON.stringify({
		token: this.token,
		check_interval: this.options.checkInterval
	}), 'utf8');

	// allow multiple calls to close()
	this.close = async.memoize(this.close.bind(this));
};

/**
 * Called when a node requests to join the pool.
 *
 * @param  {http.IncomingMessage} req
 * @param  {http.ServerResponse} res
 * @return {void}
 */
Balancer.prototype.handleNodeRegister = function(req, res) {
	function fail(err) {
		log.error(ipaddr, 'Failed to register (' + err.message + ')');
		res.writeHead(500, {'Content-Type': 'text/plain'});
		res.write(err.message);
		return res.end();
	}

	var self = this;
	var ipaddr = req.connection.remoteAddress;
	this._getJSONBody(req, function(err, body) {
		if (err) return fail(err);
		self.nodes.register(ipaddr, body, function(err, added) {
			if (err) return fail(err);
			res.writeHead(added ? 201 : 200, {'Content-Type': 'application/json'});
			res.write(self.register_body);
			res.end();
		});
	});
};

/**
 * Called when a node attempts to leave the pool (like on shutdown)
 *
 * @param  {http.IncomingMessage} req
 * @param  {http.ServerResponse} res
 * @return {void}
 */
Balancer.prototype.handleNodeUnregister = function(req, res) {
	function fail(err) {
		log.error(ipaddr, 'Failed to unregister (' + err.message + ')');
		res.writeHead(500, {'Content-Type': 'text/plain'});
		res.write(err.message);
		return res.end();
	}

	var self = this;
	var ipaddr = req.connection.remoteAddress;
	var id = req.url.substring(7).replace(/\?.*/, '');
	self.nodes.unregister(id, function(err) {
		if (err) return fail(err);
		res.writeHead(200, {'Content-Type': 'application/json'});
		res.write('{"acknowledged":true}');
		res.end();
	});
};

/**
 * Called for all incoming tile requests.
 *
 * @param  {http.IncomingMessage} req
 * @param  {http.ServerResponse} res
 * @return {void}
 */
Balancer.prototype.handleProxyRequest = function(req, res, next) {
	// /:layer/:z/:x/:y/:file?qs
	var parts = req.url.substring(1).split('/');
	if (parts.length < 4) return next();
	var layer = parts[0];
	var z = Number(parts[1]);
	var x = Number(parts[2]);
	var y;
	var file;
	if (parts[3].includes('.')) {
		var fileNamePart = parts[3].split('.');
		y = parseInt(fileNamePart[0]);
		file = '*' + fileNamePart[0].substring(y.toString().length) + '.' + fileNamePart[1];
	} else {
		y = parseInt(parts[3]);
		file = parts[4];
	}
	if (isNaN(x) || isNaN(y) || isNaN(z)) {
		return next();
	}

	var qspos = file.indexOf('?');
	if (qspos > -1) file = file.substring(0, qspos);
	if (!file) return next();

	var target = this.nodes.pick(layer, file, z, x, y);
	if (!target) {
		res.writeHead(404, {'Content-Type': 'text/plain'});
		res.write('No servers found to handle the request');
		return res.end();
	}
	this.proxy.web(req, res, {target: 'http://'+target});
};

/**
 * Reads in the request body and parses it as JSON.
 *
 * @param {http.IncomingMessage} req
 * @param {function} callback
 * @return {void}
 */
Balancer.prototype._getJSONBody = function(req, callback) {
	var body = '';
	req.setEncoding('utf8');
	req.on('error', function(err) { return callback(err); });
	req.on('data', function (data) { body += data; });
	req.on('end', function () {
		var parsedBody;
		try { parsedBody = JSON.parse(body); } catch(e) { }
		if (!parsedBody || typeof parsedBody !== 'object') {
			return callback(new Error('Invalid JSON body'));
		}
		return callback(null, parsedBody);
	});
};

/**
 * Public-facing Listener
 *
 * @param  {function} callback
 * @return {void}
 */
Balancer.prototype._listenPublic = function(callback) {
	var self = this;
	this.http_public = http.createServer(function(req, res) {
		if (req.url === '/robots.txt') {
			res.writeHead(200, {'Content-Length': BUFFER_ROBOTSTXT.length, 'Content-Type': 'text/plain'});
			res.write(BUFFER_ROBOTSTXT);
			res.end();
		} else if (req.url === '/health') {
			res.writeHead(200, {'Content-Type': 'application/json'});
			res.write('{"ok":true}');
			res.end();
		} else {
			self.handleProxyRequest(req, res, function() {
				res.writeHead(404, {'Content-Type': 'text/plain'});
				res.write('Unrecognized URL');
				res.end();
			});
		}
	});

	var port = this.options.port;
	var hostname = this.options.hostname;
	this.http_public.listen(port, hostname, function(err) {
		if (!err) log.info(null, 'Listening on ' + hostname + ':' + port + ' (public)');
		if (err) self.http_public = null;
		callback(err);
	});
};

/**
 * TileStrata-facing Listener (private)
 *
 * @param  {function} callback
 * @return {void}
 */
Balancer.prototype._listenPrivate = function(callback) {
	var self = this;
	this.http_private = http.createServer(function(req, res) {
		if (req.method === 'POST' && req.url === '/nodes') {
			self.handleNodeRegister(req, res);
		} else if (req.method === 'DELETE' && REGEX_NODES.test(req.url)) {
			self.handleNodeUnregister(req, res);
		} else {
			res.writeHead(404, {'Content-Type': 'text/plain'});
			res.write('Unrecognized URL');
			res.end();
		}
	});

	var port = this.options.privatePort;
	var hostname = this.options.hostname;
	this.http_private.listen(port, hostname, function(err) {
		if (!err) log.info(null, 'Listening on ' + hostname + ':' + port + ' (private)');
		if (err) self.http_private = null;
		callback(err);
	});
};

Balancer.prototype.close = function(callback) {
	var self = this;
	function close(prop) {
		return function(callback) {
			var http = self[prop];
			if (http) {
				return http.close(function(err) {
					if (!err) delete self[prop];
					callback(err);
				});
			}
			callback();
		};
	}
	async.parallel([
		close('http_private'),
		close('http_public')
	], function(err) {
		self.close = async.memoize(Balancer.prototype.close.bind(self));
		return callback(err);
	});
};

Balancer.prototype.listen = function(callback) {
	callback = callback || function() {};
	var self = this;
	async.parallel([
		this._listenPrivate.bind(this),
		this._listenPublic.bind(this)
	], function(err) {
		if (err) {
			log.error(null, err);
			return self.close(function() {
				callback(err);
			});
		}
		return callback();
	});
};

module.exports = Balancer;
