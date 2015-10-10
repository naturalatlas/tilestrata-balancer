# TileStrata Balancer
[![NPM version](http://img.shields.io/npm/v/tilestrata-balancer.svg?style=flat)](https://www.npmjs.org/package/tilestrata-balancer)
[![Build Status](https://travis-ci.org/naturalatlas/tilestrata-balancer.svg)](https://travis-ci.org/naturalatlas/tilestrata-balancer)
[![Coverage Status](http://img.shields.io/codecov/c/github/naturalatlas/tilestrata-balancer/master.svg?style=flat)](https://codecov.io/github/naturalatlas/tilestrata-balancer)

An elastic [metatile](http://wiki.openstreetmap.org/wiki/Meta_tiles)-aware load balancer to sit in front of multiple [TileStrata](https://github.com/naturalatlas/tilestrata) servers (must be >= [2.0.0](https://github.com/naturalatlas/tilestrata/releases/tag/v2.0.0)).

```sh
$ npm install tilestrata-balancer -g

$ tilestrata-balancer \
	--hostname=127.0.0.1 \ # bind address
	--port=8080 \ # for connections from the outside world
	--private-port=8081 \ # for connections from tilestrata tile servers
	--health-check-interval=5000 \ # how often to ping nodes
	--unhealthy-count=1 \ # consecutive unhealty pings needed to determine a host is unhealthy
```

## Configuration

*First and foremost*, whatever `--private-port` is set to needs to *not* be accessible to the outside world. This is crucial so that outside connections can't maliciously insert a random node into the pool.

On the servers upstream, use the `balancer` option to set where to find the load balancer. When TileStrata starts up, it will check-in with the load balancer, informing it that its ready to be routed to. After that, the balancer will periodically check [`/health`](https://github.com/naturalatlas/tilestrata#health-checks) to ensure the node is healthy.

```js
var strata = tilestrata({
	balancer: {
		/* the port should match --private-port */
		host: '192.168.0.1:8081',
		/* the magnitude is relative to other servers (default: 1) */
		node_weight: 3
	}
});
```

## Additional Notes

One cool thing to note is that TileStrata Balancer allows layers to be non-homogenously spread about your cluster. The balancer keeps track of what layers exist on each host. This property is great if you have multiple maps that are tough to squeeze on a single server.

### The Contract

1. TileStrata should start up and send periodic POSTs to `/nodes` until it receives a `201 Created`. The request body should contain a unique `id`, `node_weight` and a `layers` array with various parameters about each (`minZoom`, `maxZoom`, `metatile`). The successful response body (JSON) will contain a `"token"` property that is later sent as the `X-TileStrataBalancer-Token` header on health checks.
2. TileStrata Balancer will send periodic requests to `/health` on the TileStrata node to ensure it's healthy. If unhealthy, the node is dropped from the pool. TileStrata should detect the lack of incoming health checks from the balancer (indicated by `X-TileStrataBalancer-Token`) and attempt to re-register (1).

## License

Copyright &copy; 2015 [Natural Atlas, Inc.](https://github.com/naturalatlas) & [Contributors](https://github.com/naturalatlas/tilestrata-balancer/graphs/contributors)

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at: http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
