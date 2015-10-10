#!/usr/bin/env node
var Balancer = require('../lib/Balancer.js');
var argv = require('yargs')
	.options({
		"h": {
			"alias": "hostname",
			"demand": true,
			"type": "string",
			"default": "0.0.0.0",
			"description": "Bind address"
		},
		"p": {
			"alias": "port",
			"demand": true,
			"type": "number",
			"description": "Public port to listen on"
		},
		"private-port": {
			"demand": true,
			"type": "number",
			"description": "Private port to speak with TileStrata through"
		}
		"unhealthy-count": {
			"type": "number",
			"description": "Number of failed health checks allowed before instance removed from pool"
		}
	}).argv;

var balancer = new Balancer(argv);
balancer.listen();
