var HashRing = require('hashring');
var log = require('npmlog');
var request = require('request');

function NodeList(token, opts) {
	opts = opts || {};

	this.token = token;
	this.map = {};
	this.rings = {};
	this.layer_options = {};
	this.hosts_by_id = {};
	this.layers_by_id = {};
	this.check_timers_by_id = {};
	this.options = opts;
};

NodeList.prototype.ring = function(layer) {
	if (!this.rings[layer]) this.rings[layer] = new HashRing();
	return this.rings[layer];
};

NodeList.prototype.pick = function(layer, file, z, x, y) {
	var layer_opts = this.layer_options[layer];
	if (!layer_opts) return; // if no options, the layer is unknown

	// TODO: validate minzoom, maxzoom
	// TODO: validate bbox

	var metatile = layer_opts.metatile || 1;
	x -= x % metatile;
	y -= y % metatile;
	var key = layer + '|' + file + '|' + z + '|' + x + '|' + y;
	return this.ring(layer).get(key);
};

NodeList.prototype.watch = function(id) {
	if (this.check_timers_by_id[id]) return;

	var self = this;
	var unhealthy = 0;
	var interval = this.options.checkInterval;
	var maxUnhealthy = this.options.unhealthyCount;
	var target = this.hosts_by_id[id];
	var check_url = 'http://' + target + '/health';

	function performCheck() {
		self.check_timers_by_id[id] = setTimeout(function() {
			request.get(check_url, {
				timeout: interval,
				headers: {
					'X-TileStrataBalancer-Token': self.token
				}
			}, function(err, res) {
				if (err || res.statusCode !== 200) ++unhealthy;
				else unhealthy = Math.max(0, unhealthy-1);
				if (unhealthy >= maxUnhealthy) {
					log.warn(null, target + ' is unhealthy. Removing...');
					self.unregister(id);
				} else {
					performCheck();
				}
			});
		}, interval);
	}

	performCheck();
};

NodeList.prototype.register = function(ipaddr, body, callback) {
	if (!body.id) return callback(new Error('No "id" provided (unique instance id)'));
	if (!body.listen_port) return callback(new Error('No "listen_port" provided'));
	var self = this;
	var id = body.id;
	var target = ipaddr + ':' + body.listen_port;
	if (this.hosts_by_id[id]) {
		log.info('info', target + ' already in pool');
		return callback(null, false);
	}

	var entry = {};
	entry[target] = {weight: body.node_weight || 1};

	this.hosts_by_id[id] = target;
	this.layers_by_id[id] = [];
	body.layers.forEach(function(layer) {
		self.layers_by_id[id].push(layer.name);
		self.layer_options[layer.name] = layer.options;
		self.ring(layer.name).add(entry);
	});

	this.watch(id);
	log.info('pool', 'Added ' + target);
	callback(null, true);
};

NodeList.prototype.unregister = function(id, callback) {
	callback = callback || function() {};

	if (!id) return callback(new Error('No "id" provided (unique instance id)'));
	var layers = this.layers_by_id[id];
	if (!layers) return callback();
	var self = this;
	var target = self.hosts_by_id[id];
	layers.forEach(function(layerName) {
		self.ring(layerName).remove(target);
	});

	delete this.hosts_by_id[id];
	delete this.layers_by_id[id];
	clearInterval(this.check_timers_by_id[id]);
	delete this.check_timers_by_id[id];
	log.info('pool', 'Removed ' + target);
	callback();
};

module.exports = NodeList;
