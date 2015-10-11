var log = require('npmlog');
var request = require('request');
var HashRing = require('hashring');
var tilebelt = require('tilebelt');
var intersect = require('bbox-intersect');

function testbbox(x, y, z, bbox) {
	if (!bbox) return true;
	var req_bbox = tilebelt.tileToBBOX([x,y,z]);
	if (Array.isArray(bbox[0])) {
		for (var i = 0, n = bbox.length; i < n; i++) {
			if (intersect(req_bbox, bbox[i])) return true;
		}
		return false;
	}
	return intersect(req_bbox, bbox);
}

function NodeList(token, opts) {
	opts = opts || {};

	this.token = token;
	this.map = {};
	this.rings = {};
	this.layer_options = {};
	this.hosts_by_id = {};
	this.layers_by_id = {};
	this.check_timers_by_id = {};
	this.ids_by_host = {};
	this.options = opts;
};

NodeList.prototype.ring = function(layer) {
	var undef;
	if (!this.rings[layer]) {
		this.rings[layer] = new HashRing(undef, 'md5', {
			'max cache size': this.options.hashringCacheSize
		});
	}
	return this.rings[layer];
};

NodeList.prototype.pick = function(layer, file, z, x, y) {
	var layer_opts = this.layer_options[layer];
	if (!layer_opts) return; // if no options, the layer is unknown

	// don't attempt to proxy if z not valid
	if (typeof layer_opts.minZoom === 'number' && z < layer_opts.minZoom) return;
	if (typeof layer_opts.maxZoom === 'number' && z > layer_opts.maxZoom) return;

	// don't attempt to proxy if outside of layer bbox(es)
	if (!testbbox(x, y, z, layer_opts.bbox)) return;

	var metatile = layer_opts.metatile || 1;
	x -= x % metatile;
	y -= y % metatile;

	// don't include filename in key... tile.png, tile@2x.png, utfgrid.json,
	// etc should all be served off the same server to improve likelihood of
	// local cache hits on dependencies
	var key = layer + '/' + z + '/' + x + '/' + y;
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
	var existing_id = this.ids_by_host[target];
	var update_ring = true;

	if (this.hosts_by_id[id]) {
		log.info('pool', target + ' already in pool');
		return callback(null, false);
	} else if (existing_id && existing_id !== id) {
		// delete references associated with id, but keep node in ring
		this.unreference(existing_id);
		update_ring = false;
		log.warn('pool', target + ' already in pool w/different id (node did not exit cleanly): ' + existing_id + ' != ' + id);
	}

	var entry = {};
	entry[target] = {weight: body.node_weight || 1};

	this.ids_by_host[target] = id;
	this.hosts_by_id[id] = target;
	this.layers_by_id[id] = [];
	body.layers.forEach(function(layer) {
		self.layers_by_id[id].push(layer.name);
		self.layer_options[layer.name] = layer.options;
		if (update_ring) self.ring(layer.name).add(entry);
	});

	this.watch(id);
	if (update_ring) log.info('pool', 'Added ' + target);
	callback(null, update_ring);
};

NodeList.prototype.unreference = function(id) {
	// removes all host references associated to the id
	delete this.ids_by_host[this.hosts_by_id[id]];
	delete this.hosts_by_id[id];
	delete this.layers_by_id[id];
	clearTimeout(this.check_timers_by_id[id]);
	delete this.check_timers_by_id[id];
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

	this.unreference(id);
	log.info('pool', 'Removed ' + target);
	callback();
};

module.exports = NodeList;
