#!/usr/bin/env node
var Balancer = require('../lib/Balancer.js');
var argv = require('yargs')
    .usage('Usage: $0 --port=[num] --private-port=[num]')
	.options({
		"port": {
			"alias": "p",
			"demand": true,
			"type": "number",
			"description": "Public port to listen on"
		},
		"hostname": {
			"demand": true,
			"type": "string",
			"default": "0.0.0.0",
			"description": "Bind address"
		},
		"private-port": {
			"demand": true,
			"type": "number",
			"description": "Private port to speak with TileStrata through"
		},
		"check-interval": {
			"type": "number",
			"description": "How often to ping children for health info (ms)"
		},
		"unhealthy-count": {
			"type": "number",
			"description": "Number of failed health checks allowed before instance removed from pool"
		}
	}).argv;

var balancer = new Balancer(argv);
balancer.listen();
