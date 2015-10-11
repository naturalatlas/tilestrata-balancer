var http = require('http');
var async = require('async');
var assert = require('chai').assert;
var Balancer = require('../lib/Balancer.js');
var tilestrata = require('tilestrata');

function waitToEstablish(strata, callback) {
	async.whilst(
		function() { return strata.balancer.reconnecting(); },
		function(callback) {
			setTimeout(callback, 100);
		},
		callback);
}

describe('TileStrata Balancer', function() {
	var balancer, strata, strata2;
	afterEach(function(done) {
		async.series([
			function(callback) {
				if (strata) return strata.close(callback);
				callback();
			},
			function(callback) {
				if (strata2) return strata2.close(callback);
				callback();
			},
			function(callback) {
				if (balancer) return balancer.close(callback);
				callback();
			}
		], done);
	});

	it('should work normally', function(done) {
		this.timeout(5000);

		async.series([
			function setupBalancer(callback) {
				balancer = new Balancer({
					hostname: '127.0.0.1',
					port: '8081',
					privatePort: 8880
				});

				balancer.listen(callback);
			},
			function setupTileStrata(callback) {
				strata = tilestrata({
					balancer: {
						host: '127.0.0.1:8880',
						register_mindelay: 10,
						register_maxdelay: 10,
						register_timeout: 100
					}
				});

				strata.layer('mylayer').route('tile.txt')
					.use({
						serve: function(server, tile, callback) {
							var message = new Buffer(JSON.stringify({
								x: tile.x,
								y: tile.y,
								z: tile.z,
								layer: tile.layer,
								filename: tile.filename,
								method: tile.method,
								qs: tile.qs
							}), 'utf8');
				            callback(null, message, {'Content-Type': 'text/plain', 'X-Test': 'a'});
						}
					});

				strata.listen(8082, callback);
			},
			function waitForEstablish(callback) {
				waitToEstablish(strata, callback);
			},
			function issueRequestToSucceed(callback) {
				http.get('http://127.0.0.1:8081/mylayer/3/2/1/tile.txt?someqs', function(res) {
					assert.equal(res.statusCode, 200);
					assert.equal(res.headers['x-test'], 'a');
					var body = '';
					res.setEncoding('utf8');
					res.on('data', function(chunk) { body += chunk; });
					res.on('end', function() {
						assert.deepEqual(JSON.parse(body), {"x":2,"y":1,"z":3,"layer":"mylayer","filename":"tile.txt","method":"GET","qs":"someqs"});
						callback();
					});
				}).on('error', function(err) {
					throw new Error('Request failed (' + err.message + ')');
				});
			},
			function closeTileStrata(callback) {
				strata.close(callback);
			},
			function setupUnbalancedTileStrata(callback) {
				// to make sure the host was removed from the hash ring
				strata = tilestrata();
				strata.layer('mylayer').route('tile.txt')
					.use({serve: function() { throw new Error('This should not have been called'); }});

				strata.listen(8082, callback);
			},
			function issueRequestToFail(callback) {
				http.get('http://127.0.0.1:8081/mylayer/3/2/1/tile.txt', function(res) {
					assert.equal(res.statusCode, 404);
					res.setEncoding('utf8');
					var body = '';
					res.on('data', function(chunk) { body += chunk; });
					res.on('end', function() {
						assert.equal(body, 'No servers found to handle the request');
						callback();
					});
				}).on('error', callback);
			}
		], function(err) {
			if (err) throw err;
			done();
		});
	});
	it('should remove nodes removed from pool if /health check fails', function(done) {
		this.timeout(5000);
		var failAfter = 8;
		var checkInterval = 100;
		var unhealthyCount = 2;
		var healthChecks = 0;

		async.series([
			function setupBalancer(callback) {
				balancer = new Balancer({
					hostname: '127.0.0.1',
					port: '8081',
					privatePort: 8880,
					checkInterval: checkInterval,
					unhealthyCount: unhealthyCount
				});

				balancer.listen(callback);
			},
			function setupTileStrata(callback) {
				strata = tilestrata({
					balancer: {
						host: '127.0.0.1:8880',
						register_mindelay: 10,
						register_maxdelay: 10,
						register_timeout: 100
					},
					healthy: function(callback) {
						healthChecks++;

						if (healthChecks === 1) return callback();
						if (healthChecks === 2) return callback(new Error('Unhealthy'));
						if (healthChecks === 3) return callback();
						if (healthChecks === 4) return callback();
						if (healthChecks === 5) return callback(new Error('Unhealthy'));
						if (healthChecks === 6) return callback();
						if (healthChecks === 7) return callback();
						if (healthChecks === 8) return callback(new Error('Unhealthy'));
						if (healthChecks === 9) return; // time out
						throw new Error('Too many health checks');
					}
				});

				strata.layer('mylayer').route('tile.txt')
					.use({
						serve: function(server, tile, callback) {
							var message = new Buffer(JSON.stringify({
								x: tile.x,
								y: tile.y,
								z: tile.z,
								layer: tile.layer,
								filename: tile.filename,
								method: tile.method,
								qs: tile.qs
							}), 'utf8');
				            callback(null, message, {'Content-Type': 'text/plain', 'X-Test': 'a'});
						}
					});

				strata.listen(8082, callback);
			},
			function waitForEstablish(callback) {
				waitToEstablish(strata, callback);
			},
			function waitForFirstFailedHealthCheck(callback) {
				var ms = checkInterval*(failAfter)+10;
				setTimeout(function() {
					assert.equal(healthChecks, failAfter, 'Check count after ' + ms + 'ms');
					callback();
				}, ms);
			},
			function issueRequestToSucceed(callback) {
				// instance should still be "healthy"
				http.get('http://127.0.0.1:8081/mylayer/3/2/1/tile.txt?someqs', function(res) {
					assert.equal(res.statusCode, 200);
					callback();
				}).on('error', function(err) {
					throw new Error('Request failed (' + err.message + ')');
				});
			},
			function waitForSecondFailedHealthCheck(callback) {
				setTimeout(callback, checkInterval*unhealthyCount+10);
			},
			function issueRequestToFail(callback) {
				http.get('http://127.0.0.1:8081/mylayer/3/2/1/tile.txt', function(res) {
					assert.equal(res.statusCode, 404);
					callback();
				}).on('error', callback);
			}
		], function(err) {
			if (err) throw err;
			done();
		});
	});

	it('should acknowledge layer bbox option', function(done) {
		async.series([
			function setupBalancer(callback) {
				balancer = new Balancer({
					hostname: '127.0.0.1',
					port: '8081',
					privatePort: 8880,
					checkInterval: 100,
					unhealthyCount: 5
				});

				balancer.listen(callback);
			},
			function setupTileStrata(callback) {
				strata = tilestrata({
					balancer: {
						host: '127.0.0.1:8880',
						register_mindelay: 10,
						register_maxdelay: 10,
						register_timeout: 100
					}
				});
				strata.layer('mylayer', {bbox: [[-85,43,-84,44]]}).route('tile.txt')
					.use({serve: function(server, tile, callback) {
						return callback(null, new Buffer('res', 'utf8'), {});
					}});

				strata.listen(8082, callback);
			},
			function waitForEstablish(callback) {
				waitToEstablish(strata, callback);
			},
			function issueRequest(callback) {
				http.get('http://127.0.0.1:8081/mylayer/14/3204/5909/tile.txt', function(res) {
					assert.equal(res.statusCode, 404);
					callback();
				});
			}
		], done);
	});

	it('should acknowledge layer metatile option', function(done) {
		this.timeout(5000);
		var metatile = 4;
		var tile = function(z,x,y) {
			return [z, x, y].join('/');
		};
		var expected_server1 = [tile(3,0,0),tile(3,1,1),tile(3,2,2),tile(3,3,3)];
		var expected_server2 = [tile(1,4,3),tile(1,5,3),tile(1,6,3),tile(1,7,3)];
		async.series([
			function setupBalancer(callback) {
				balancer = new Balancer({
					hostname: '127.0.0.1',
					port: '8081',
					privatePort: 8880,
					checkInterval: 100,
					unhealthyCount: 5
				});

				balancer.listen(callback);
			},
			function setupTileStrata1(callback) {
				strata = tilestrata({
					balancer: {
						host: '127.0.0.1:8880',
						register_mindelay: 10,
						register_maxdelay: 10,
						register_timeout: 100
					}
				});
				strata.layer('mylayer', {metatile: metatile}).route('tile.txt')
					.use({serve: function(server, tile, callback) {
						return callback(null, new Buffer('res', 'utf8'), {
							'X-Server': '1'
						});
					}});

				strata.listen(8082, callback);
			},
			function setupTileStrata2(callback) {
				strata2 = tilestrata({
					balancer: {
						host: '127.0.0.1:8880',
						register_mindelay: 10,
						register_maxdelay: 10,
						register_timeout: 100
					}
				});
				strata2.layer('mylayer', {metatile: metatile}).route('tile.txt')
					.use({serve: function(server, tile, callback) {
						return callback(null, new Buffer('res', 'utf8'), {
							'X-Server': '2'
						});
					}});
				strata2.listen(8083, callback);
			},
			function waitForEstablish1(callback) {
				waitToEstablish(strata, callback);
			},
			function waitForEstablish2(callback) {
				waitToEstablish(strata2, callback);
			},
			function issueRequestsA(callback) {
				async.each(expected_server1, function(key, callback) {
					http.get('http://127.0.0.1:8081/mylayer/'+key+'/tile.txt', function(res) {
						assert.equal(res.statusCode, 200);
						assert.equal(res.headers['x-server'], '1', 'X-Server header for ' + key);
						callback();
					});
				}, callback);
			},
			function issueRequestsB(callback) {
				async.each(expected_server2, function(key, callback) {
					http.get('http://127.0.0.1:8081/mylayer/'+key+'/tile.txt', function(res) {
						assert.equal(res.statusCode, 200);
						assert.equal(res.headers['x-server'], '2', 'X-Server header for ' + key);
						callback();
					});
				}, callback);
			}
		], done);
	});

	it('should handle hard-restarts of tilestrata (id change)', function(done) {
		this.timeout(5000);
		var stratahttp;

		function initserver(callback) {
			strata = tilestrata({
				balancer: {
					host: '127.0.0.1:8880',
					register_mindelay: 10,
					register_maxdelay: 10,
					register_timeout: 100
				}
			});
			strata.layer('mylayer').route('tile.txt')
				.use({serve: function(server, tile, callback) {
					return callback(null, new Buffer('res', 'utf8'), {});
				}});

			strata.listen(8082, callback);
		};

		async.series([
			function setupBalancer(callback) {
				balancer = new Balancer({
					hostname: '127.0.0.1',
					port: '8081',
					privatePort: 8880,
					checkInterval: 50,
					unhealthyCount: 2
				});

				balancer.listen(callback);
			},
			function setupTileStrata(callback) {
				initserver(callback);
			},
			function waitForEstablish(callback) {
				waitToEstablish(strata, callback);
			},
			function restartTileStrata(callback) {
				strata.close(function(err) {
					if (err) throw err;
					stratahttp = strata.listen(8082, callback);
				});
			},
			function wait1(callback) {
				// wait for any health checks to fail
				setTimeout(callback, 500);
			},
			function issueRequest1(callback) {
				http.get('http://127.0.0.1:8081/mylayer/3/2/1/tile.txt', function(res) {
					assert.equal(res.statusCode, 200);
					callback();
				});
			},
			function hardRestartTileStrata(callback) {
				// don't exit balancer cleanly (don't notify balancer)
				assert.isTrue(!!strata.balancer_timeout);
				clearTimeout(strata.balancer_timeout);
				stratahttp.close(function(err) {
					if (err) throw err;
					initserver(callback);
				});
			},
			function wait2(callback) {
				// wait for any health checks to fail
				setTimeout(callback, 500);
			},
			function issueRequest2(callback) {
				http.get('http://127.0.0.1:8081/mylayer/3/2/1/tile.txt', function(res) {
					assert.equal(res.statusCode, 200);
					callback();
				});
			},
			function checkState(callback) {
				assert.equal(Object.keys(balancer.nodes.hosts_by_id).length, 1, 'Entries in hosts_by_id');
				assert.equal(Object.keys(balancer.nodes.layers_by_id).length, 1, 'Entries in layers_by_id');
				assert.equal(Object.keys(balancer.nodes.check_timers_by_id).length, 1, 'Entries in check_timers_by_id');
				assert.equal(Object.keys(balancer.nodes.ids_by_host).length, 1, 'Entries in ids_by_host');
				callback();
			}
		], done);
	});
});
