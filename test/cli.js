var fs = require('fs');
var assert = require('chai').assert;
var exec = require('child_process').exec;
var bin = 'node ./bin/tilestrata-balancer.js';
var version = JSON.parse(fs.readFileSync('./package.json', 'utf8')).version;

describe('TileStrata Balancer CLI', function() {
	describe('--version', function() {
		it('should return version', function(done) {
			exec(bin + ' --version', function(err, stdout, stderr) {
				if (err) throw err;
				var actualVersion = String(stdout).trim();
				assert.isTrue(!!actualVersion, 'not empty');
				assert.equal(actualVersion, version);
				done();
			});
		});
	});
});
