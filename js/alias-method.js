/*
An Alias Method implementation written in JavaScript

Copyright (c) 2016 Hans Jorgensen

Permission is hereby granted, free of charge, to any person obtaining a copy of 
this software and associated documentation files (the "Software"), to deal in 
the Software without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the 
Software, and to permit persons to whom the Software is furnished to do so, 
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all 
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR 
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS 
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR 
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER 
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN 
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

(function(global){
	/**
	 * Returns a random sampler for the discrete probability distribution
	 * defined by the given array
	 * @param inputProbabilities The array of input probabilities to use.
	 *   The array's values must be Numbers, but can be of any magnitude
	 * @returns A function with no arguments that, when called, returns
	 *   a number between 0 and inputProbabilities.length with respect to
	 *   the weights given by inputProbabilities.
	 */
	function alias_sampler(inputProbabilities) {
		var probabilities, aliases;
		
		// First copy and type-check the input probabilities,
		// also taking their sum.
		probabilities = inputProbabilities.map(function(p, i){
			if (Number.isNaN(Number(p))){
				throw new TypeError("Non-numerical value in distribution at index " + i);
			}
			return Number(p);		
		});
		var probsum = inputProbabilities.reduce(function(sum, p){
			return sum + p;
		}, 0);
		
		// Scale all of the probabilities such that their average is 1
		// (i.e. if all of the input probabilities are the same, then they 
		// are all set to 1 by this procedure)
		var probMultiplier = inputProbabilities.length / probsum;
		probabilities = probabilities.map(function(p, i) {
			return p * probMultiplier;
		});
		
		// Sort the probabilities into overFull and underFull queues
		var overFull = [], underFull = [];
		probabilities.forEach(function (p, i){
			if (p > 1) overFull.push(i);
			else if (p < 1) underFull.push(i);
			else if (p !== 1) {
				throw new Error("User program has disrupted JavaScript defaults "
				+ "and prevented this function from executing correctly.");
			}
		});

		// Construct the alias table.
		// In each iteration, the remaining space in an underfull cell
		// will be filled by surplus space from an overfull cell, such
		// that the underfull cell becomes exactly full.
		// The overfull cell will then be reclassified as to how much
		// probability it has left.
		aliases = [];
		while (overFull.length > 0 || underFull.length > 0) {
			if (overFull.length > 0 && underFull.length > 0){
				aliases[underFull[0]] = overFull[0];
				probabilities[overFull[0]] += probabilities[underFull[0]] - 1;
				underFull.shift();
				if (probabilities[overFull[0]] > 1) overFull.push(overFull.shift());
				else if (probabilities[overFull[0]] < 1) underFull.push(overFull.shift());
				else overFull.shift();
			} else {
				// Because the average of all the probabilities is 1, mathematically speaking,
				// this block should never be reached. However, because of rounding errors
				// posed by floating-point numbers, a tiny bit of surplus can be left over.
				// The error is typically neglegible enough to ignore.
				var notEmptyArray = overFull.length > 0 ? overFull : underFull;
				notEmptyArray.forEach(function(index) {
					probabilities[index] = 1;
				});
				notEmptyArray.length = 0;
			}
		}
		
		// Finally, create and return the sampler. With the creation of the alias table,
		// each box now represents a biased coin whose possibilities are either it or
		// its corresponding alias (the overfull cell it took from). The sampler picks
		// one of these coins with equal probability for each, then flips it and returns
		// the result.
		return function sample() {
			var index = Math.floor(Math.random() * probabilities.length);
			return Math.random() < probabilities[index] ? index : aliases[index];
		}
	}
	
	// Export AMD/CommonJS if possible, put in browser global otherwise.
	if (typeof define === "function" && define.amd){
		define ("alias-sampler", [], function() { return alias_sampler; });
	} else if (typeof module === "object" && module.exports){
		module.exports = alias_sampler;
	} else {
		global.alias_sampler = alias_sampler;
	}
})(this);

