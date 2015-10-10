var HashRing = require('hashring');
var log = require('npmlog');

// TODO: implement check_interval

function NodeList() {
	this.map = {};
	this.rings = {};
	this.layer_options = {};
	this.hosts_by_id = {};
	this.layers_by_id = {};
}

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

NodeList.prototype.register = function(ipaddr, body, callback) {
	if (!body.id) return callback(new Error('No "id" provided (unique instance id)'));
	if (!body.listen_port) return callback(new Error('No "listen_port" provided'));
	var self = this;
	var target = ipaddr + ':' + body.listen_port;
	var entry = {};
	entry[target] = {weight: body.node_weight || 1};

	self.layers_by_id[body.id] = [];
	body.layers.forEach(function(layer) {
		self.layers_by_id[body.id].push(layer.name);
		self.hosts_by_id[body.id] = target;
		self.layer_options[layer.name] = layer.options;
		self.ring(layer.name).add(entry);
	});

	log.info('pool', 'Added ' + target);
	callback();
};

NodeList.prototype.unregister = function(ipaddr, body, callback) {
	if (!body.id) return callback(new Error('No "id" provided (unique instance id)'));
	var id = body.id;
	var layers = this.layers_by_id[id];
	if (!layers) return callback();
	var self = this;
	var target = self.hosts_by_id[id];
	layers.forEach(function(layerName) {
		self.ring(layerName).remove(target);
	});

	delete this.hosts_by_id[id];
	delete this.layers_by_id[id];
	log.info('pool', 'Removed ' + target);
	callback();
};

module.exports = NodeList;
