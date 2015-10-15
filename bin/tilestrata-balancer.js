#!/usr/bin/env node
var fs = require('fs');
var path = require('path');
var Balancer = require('../lib/Balancer.js');
var yargs = require('yargs')
    .usage('Usage: $0 --port=[num] --private-port=[num]')
	.options({
		"port": {
			"alias": "p",
			"type": "number",
			"default": 8080,
			"description": "Public port to listen on"
		},
		"hostname": {
			"type": "string",
			"default": "0.0.0.0",
			"description": "Bind address"
		},
		"private-port": {
			"type": "number",
			"default": 8081,
			"description": "Private port to speak with TileStrata through"
		},
		"check-interval": {
			"type": "number",
			"default": 5000,
			"description": "How often to ping children for health info (ms)"
		},
		"unhealthy-count": {
			"type": "number",
			"default": 1,
			"description": "Number of failed health checks allowed before instance removed from pool"
		},
		"hashring-cache-size": {
			"type": "number",
			"description": "Size of LRU for hash ring lookups (per layer)",
			"default": 5000
		},
		"version": {
			"alias": "v",
			"description": "Prints current version"
		},
		"help": {
			"description": "Prints help information"
		}
	});

var argv = yargs.argv;
if (argv.help) {
	yargs.showHelp();
} else if (argv.version) {
	var pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
	console.log(pkg.version);
} else {
	var balancer = new Balancer(argv);
	balancer.listen();
}
