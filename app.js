function mainCurve($elem, inputData, maxScaleY, isAdaptive) {
    var HISTOGRAMQ = 0.3; // Default Q
    var DENSQ = 0.55; // Smoothing of the density function, in value units
	if (isAdaptive) {
		DENSQ = 400;
	}
    var TRANSITION_DUR = 750; // ms
    var CDFQ = HISTOGRAMQ/8;
    var SHOWCDF = false; // Default value - show cdf function at startup
    var SHOWDENSITY = true; // Default value - show density function at startup

    //setting up empty data array
    var data = [];
    var xData = [];
	var xDataTicks = [];
    var yData = [];

    getData(); // popuate data 

    // line chart based on http://bl.ocks.org/mbostock/3883245
    var margin = {
            top: 20,
            right: 20,
            bottom: 30,
            left: 50
        },
        width = 960 - margin.left - margin.right,
        height = 500 - margin.top - margin.bottom;

	var svg = d3.select("body").append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    var x = d3.scale.linear()
        .range([0, width]);

    var y = d3.scale.linear()
        .range([height, 0]);

	if (inputData === undefined) {
		x.domain(d3.extent(data, function(d) {
			return d[0];
		}));
		y.domain(d3.extent(data, function(d) {
			return d[1];
		}));
	} else {
		x.domain([d3.min(xData) - 1, d3.max(xData) + 1]);
		y.domain([0, maxScaleY]);

		var nrPoints = Math.round(width / 2);
		xDataTicks = x.ticks(nrPoints);
		createGroundTruthData();
	}

	var line = d3.svg.line()
			.x(function(d) {
				return x(d[0]);
			})
			.y(function(d) {
				return y(d[1]);
			});
		svg.append("path")
			.datum(data)
			.attr("class", "line")
			.attr("d", line);

    var xAxis = d3.svg.axis()
        .scale(x)
        .orient("bottom");

    var yAxis = d3.svg.axis()
        .scale(y)
        .orient("left");

    svg.append("g")
        .attr("class", "x axis")
        .attr("transform", "translate(0," + height + ")")
        .call(xAxis);

    svg.append("g")
        .attr("class", "y axis")
        .call(yAxis);

    function getData() {
        if (inputData === undefined) {
			createGaussianData();
		} else {
			inputData.sort(function (x, y) {
				return x - y;
			});
			xData = inputData;
			var n = xData.length;
			csvLog("n", n);
			var sigmaHat = getSigmaHat(xData);
			csvLog("sigma hat", d3.round(sigmaHat, 2));
			var recommendedBandwidth = Math.pow(
				4*Math.pow(sigmaHat, 5)/(3*n), 1/5);
			csvLog("h", d3.round(recommendedBandwidth, 2));
		}
    }

	function createGaussianData() {
		// loop to populate data array with 
        // probabily - quantile pairs
        for (var i = 0; i < 1e5; i++) {
            var x = normal();
            var y = standardNormalDistribution(x); // calc prob of rand draw
            var el = [x, y];
            data.push(el);
        };

		// need to sort for plotting
        //https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
        data.sort(function(a, b) {
            return a[0] - b[0];
        });

        data.forEach(function (el) {
            xData.push(el[0]);
            yData.push(el[1]);
        });
	}

    function getCdf(data, q, xScale, logScaleBase, maxPoints) {
		var xDomain = xScale.domain();
		var leftX = xDomain[0];
		var rightX = xDomain[1];
		var maxQ = Math.max(q, (rightX - leftX)/maxPoints);

		var binnedData = getHistogram(data, maxQ, logScaleBase);

		if (binnedData.length==0)
			return [];

		binnedData = binnedData.filter(function (elem) {
			return elem.x >= leftX && elem.x <= rightX; 
		});

		var xOffset = binnedData[0].dx/2;

		var cdfData=[];
		var aggr=0;
		for (var i=0, len=binnedData.length; i<len; i++) {
			aggr+=binnedData[i].y;
			cdfData.push([binnedData[i].x+xOffset, aggr]);
		}

		// Add termination points
		cdfData.splice(0, 0, [leftX, 0]);
		cdfData.push([rightX, 1]);

		return cdfData;
	}

    function getDensityDistribution(data, q) {

		function getNumberOfSamplesInArea(x, radius, sample) {
			var sum = 0;
			var n = sample.length;
			for (var i = 0; i < n; i++) {
				var xVal = sample[i];
				var left = x - radius;
				var right = x + radius;
				if (xVal > right) {
					break;
				}
				if (xVal >= left && xVal <= right) {
					sum++;
				}
			}
			return sum;
		}

		function getScaleFromPosition(x, radius, sample) {
			var samplesInArea = getNumberOfSamplesInArea(x, radius, sample);
			if (samplesInArea == 0) {
				scale = 200 * q;
			} else {
				scale = 2 * q / samplesInArea;
			}
			return scale;
		}

		function kernelDensityEstimator(kernelFunc, x) {
			return function(sample) {
				var scaleFromPosition = {};
				if (isAdaptive) {
					var sqrtN = Math.sqrt(sample.length);
					sample.forEach(function (v) {
						scaleFromPosition[v] = getScaleFromPosition(v, sqrtN, sample);
					});
				}
				return x.map(function(x) {
					var scale = q;
					return [x, d3.mean(sample, function(v) {
						if (isAdaptive) {
							scale = scaleFromPosition[v];
						}
						return kernelFunc()((x - v) / scale) / scale; 
					})];
				});
			};
		}

		function epanechnikovKernel() {
			return function(u) {
				return Math.abs(u) <= 1 ? .75 * (1 - u * u) : 0;
			};
		}

		var densityData = kernelDensityEstimator(epanechnikovKernel, xDataTicks)(data);
		
		// Add termination points
		//densityData.splice(0,0,[0,0]);
		//densityData.push([xScale.domain()[1],0]);
		return densityData;
	}

    function initStatic(svg) {
        var linScale = x;
        y2Scale = getY2Scale();

        densityData = getDensityDistribution(xData, DENSQ);
		cdfData = getCdf(xData, CDFQ, linScale, 1, width/2);
		integralData = getIntegralData(densityData);
    }

    // from http://bl.ocks.org/mbostock/4349187
    // Sample from a normal distribution with mean 0, stddev 1.
    function normal() {
        var x = 0,
            y = 0,
            rds, c;
        do {
            x = Math.random() * 2 - 1;
            y = Math.random() * 2 - 1;
            rds = x * x + y * y;
        } while (rds == 0 || rds > 1);
        c = Math.sqrt(-2 * Math.log(rds) / rds); // Box-Muller transform
        return x * c; // throw away extra sample y * c
    }

    var redrawNewBin = _.throttle(function (newQ) {
		histQ = newQ;
		histogramData = getHistogram(xData, histQ, logScaleBase);

		renderHistogram(svg, histogramData, x, y);
	}, 200, { leading: false });

    function addControls ($elem) {
		//// Bin control
		var binStepper = $('<input>')
			.css('width', 100);

		// Linear/log scale
        /*
		var logRadio = $('<input type="radio" name="scaleType" value="' + LOGSCALEBASE + '">');
		var linearRadio = $('<input type="radio" name="scaleType" value="1">');

		(logScaleBase==1?linearRadio:logRadio).attr('checked', 'checked');

		var logAddedMult = $('<span>')
			.html(logScaleBase==1?'':'(*' + logScaleBase + '<sup>n</sup>)');

		var scaleRadio=$('<span>').append(
				$('<label>').append(linearRadio, ' Linear').css('cursor', 'pointer'),
				$('<label>').append(logRadio, ' Log scale').css({'cursor': 'pointer', 'margin-left': 5})
		).css('margin-left', 20);
        */
		// CDF
		var cdfCb = $('<input type="checkbox">');

		if (showCdf)
			cdfCb.attr('checked', 'checked');

		// Density
		var densCb = $('<input type="checkbox">');

		if (showDensity)
			densCb.attr('checked', 'checked');

		var binWidthSpan = $('<span>');
		if (!isAdaptive) {
			binWidthSpan = $('<span>').append(
				$('<label>').append('Bin width:').css('margin-right', 5),
				binStepper/*,
				$('<span>').append(logAddedMult).css('margin-left', 3)*/
			).css('margin-left', 7);

			binStepper.slider({
				step: 0.1,
				max: 5,
				min: 0.1,
				value: HISTOGRAMQ,
				tooltip: 'always'
			}).on('change', function(e) {
				redrawNewBin(e.value.newValue);
			});
		} 
		
		
		$('<div>').appendTo($elem).append([
			binWidthSpan,
			//scaleRadio,
			$('<label>').append(densCb, ' Show density')
				.css({'cursor': 'pointer', 'margin-left': 25}),
			$('<label>').append(cdfCb, ' Show cdf and density integral')
				.css({'cursor': 'pointer', 'margin-left': 15})
		]).css({
			'text-align': 'center',
			'margin-top': 5
		});

        /*
		$.each([linearRadio, logRadio], function() {
			$(this).change( function() {
				logScaleBase=parseInt($(this).val());
				logAddedMult.html(logScaleBase==1?'':'(*' + logScaleBase + '<sup>n</sup>)');
				xScale = getXScale(data, logScaleBase);
				setInitZoomLevel();
				redraw();
			})
		});
        */
		cdfCb.change(function () {
			showCdf=this.checked;
			renderCdf(svg, cdfData, integralData, x, y2Scale);
			svg.select('.y2-axis')
				.transition().duration(TRANSITION_DUR)
				.style('opacity', (showCdf?1:0));
		});

		densCb.change( function() {
			showDensity=this.checked;
			renderDensity(svg, densityData, x, y);
		});

	}

    //taken from Jason Davies science library
    // https://github.com/jasondavies/science.js/
    function standardNormalDistribution(x) {
        return gaussianDistribution(0, 1)(x);
    }

    function getY2Scale() {
		return d3.scale.linear()
			.domain([0, 1])
			.range([height, 0]);
	}

    function renderCdf(svg, cdfData, integralData, xScale, yScale) {
		// CDF line
		var line = d3.svg.line()
			.x(function(d) { return xScale(d[0]); })
			.y(function(d) { return yScale(d[1]); })
			.interpolate("basis");

		var lines = svg.selectAll('.cdf-line')
			.data([(showCdf?cdfData:[])]);

		var linesIntegral = svg.selectAll('.integral-line')
			.data([(showCdf?integralData:[])]);

		linesIntegral.enter()
			.append("path")
			.attr("class", "integral-line")
			.style({
				"fill": "none",
				"stroke": "black",
				"stroke-opacity": .4,
				"stroke-width": "2px"
			});
		
		lines.enter()
			.append("path")
			.attr("class", "cdf-line")
			.style({
				"fill": "none",
				"stroke": "green",
				"stroke-opacity": .4,
				"stroke-width": "2px"
			})
			.on("mouseover", function() {
				var coords= d3.mouse(this);
				var x = xScale.invert(coords[0]);
				var y = yScale.invert(coords[1]);

				d3.select(this).select('title')
					.text('<' + d3.round(x,2) + ': ' + d3.round(y*100, 2) + '%');

				d3.select(this)
					.transition()
					.style({
						"stroke-width": "3px",
						"stroke-opacity": .9
					})
			})
			.on("mouseout", function() {
				svg.select('.cdf-line')
					.transition()
					.style({
						"stroke-width": "2px",
						"stroke-opacity": .4
					})
			})
			.append('title');


		lines
		  .transition().duration(TRANSITION_DUR)
			.attr("d", line);
		
		linesIntegral
			.transition().duration(TRANSITION_DUR)
			.attr("d", line);
	}

    function renderDensity(svg, data, xScale, yScale) {
		var thisData = showDensity?data.slice(0):[];

		// Add termination points
		thisData.splice(0,0,[xScale.domain()[0],0]);
		thisData.push([xScale.domain()[1],0]);

		var line = d3.svg.line()
			.x(function(d) { return xScale(d[0]); })
			.y(function(d) { return yScale(d[1]); })
			.interpolate("basis");

		var lines = svg.selectAll('.density-line')
			.data([thisData]);

		lines.enter()
			.append("path")
			.attr("class", "density-line")
			.style({
				"fill": "blue",
				"fill-opacity": .13,
				"stroke": "none"
			});

		lines
		  //.datum(function(d) { return d; })
		  .transition().duration(TRANSITION_DUR)
			  .attr("d", line);
	}

    function renderHistogram(svg, data, xScale, yScale) {
		var bars = svg.selectAll(".histo-bar")
			.data(data);

		bars.exit()
			.transition()
				.style({
					"fill-opacity": 0,
					"stroke-opacity": 0
				})
				.remove();

	   bars.transition().duration(TRANSITION_DUR)
		  .attr("x", function(d) { return xScale(d.x); })
		  .attr("y", function(d) { return yScale(d.y / d.dx); })
		  .attr("width", function(d) { return xScale(d.x + d.dx) - xScale(d.x); })
		  .attr("height", function(d) {
                var dHeight = height - yScale(d.y);
				dHeight /= d.dx;
                return Math.max(0, dHeight); 
            });

		var newBars = bars.enter()
		  .append("rect")
		  .attr("class", "histo-bar");

		newBars
			.attr("rx", 1)
			.attr("ry", 1)
			.style({
				"fill": "lightgrey",
				"fill-opacity": .3,
				"stroke": "brown",
				"stroke-opacity": .4,
				"shape-rendering": "crispEdges",
				"cursor": "crosshair"
			})
			.attr("x", function(d) { return xScale(d.x); })
			.attr("width", function(d) { return xScale(d.x + d.dx) - xScale(d.x); })
			.attr("y", height)
			.attr("height", 0)
			.transition().duration(TRANSITION_DUR)
				.attr("y", function(d) { return yScale(d.y / d.dx); })
				.attr("height", function(d) {
                    var dHeight = height - yScale(d.y);
					dHeight /= d.dx;
                    return Math.max(0, dHeight); 
                });


		newBars
			.on("mouseover", function() {
				d3.select(this)
					//.transition().duration(70)
					.style({
						"stroke-opacity": .9,
						"fill-opacity": .7
					});
			})
			.on("mouseout", function() {
				d3.select(this)
					//.transition().duration(250)
					.style({
						"stroke-opacity": .4,
						"fill-opacity": .3
					});
			});

		newBars.append('title');
		var sqrtN = d3.round(Math.sqrt(xData.length));
		var percentage = d3.round(100 * sqrtN / xData.length, 2);
		bars.select('title')
			.text(function(d) {
				if (!isAdaptive) {
					percentage = d3.round(d.y*100,2);
				}
				var barHeight = d.y / d.dx;
				return d.x + ' bis ' + (d.x+d.dx) + ": " + 
				percentage + "% (" + d.length + " Sample)\n" + 
				"Hoehe: " + d3.round(barHeight, 2) + "\n" +
				"Flaeche: " + d3.round(d.dx * barHeight, 4);
			});
	}

    function redraw() {
		var histogramData;
		if (!isAdaptive) {
			histogramData = getHistogram(xData, histQ, logScaleBase);
		} else {
			histogramData = getAdaptiveHistogram(xData);
		}

		renderDensity(svg, densityData, x, y);
		renderHistogram(svg, histogramData, x, y);
		renderCdf(svg, cdfData, integralData, x, y2Scale);

		var densityRMSE = getDensityRMSE(densityData, groundTruthMixedNormalDistribution);
		var histogramRMSE = getHistogramRMSE(histogramData, groundTruthMixedNormalDistribution);
		var densityKLDiv = getKullbackLeiblerDivergence(densityData, groundTruthMixedNormalDistribution);
		var cdfIntegralDiff = 
			getDiffFromDensityIntegralAndCDF(cdfData, integralData);

		csvLog("Density RMSE", d3.round(densityRMSE, 4));
		csvLog("Histogram RMSE", d3.round(histogramRMSE, 4));
		csvLog("Density KL Divergenz", d3.round(densityKLDiv, 4));
		csvLog("Diff between density integral and CDF", 
			d3.round(cdfIntegralDiff, 6));
		console.log("\n");

		
    }

    function getHistogram(data, q, logScaleBase) {
		var dataRange;
		if (inputData === undefined) {
			dataRange=[-5, 5];
		} else {
			dataRange = [d3.min(data) - 10, d3.max(data) + 10];
		}
		logScaleBase = (logScaleBase==null?1:logScaleBase);

		var base=1/logScaleBase;
		var expQ=Math.pow(q*Math.pow(base,4) , base);  // Incremental Q

		var points = [];
		for (var p = Math.pow(dataRange[0], base),len=Math.pow(dataRange[1], base); p<len; p+=expQ)
			points.push(d3.round(Math.pow(p,1/base), 2));

		points.push(d3.round(dataRange[1], 2));

		histogram = d3.layout.histogram()
			.frequency(false)
			.bins(points);
			
        return histogram(data);
	}
	
	function getAdaptiveHistogram(data) {
		var n = data.length;
		var sqrtN = Math.round(Math.sqrt(n));
		
		var points = [];
		var y = sqrtN / n;
		for (var i = 0; i < n; i += sqrtN) {
			var x = data[i];
			var x2 = data[Math.min(i + sqrtN, n - 1)];
			var dx = x2 - x;
			points.push({
				x: x,
				dx: dx,
				y: y,
				length: sqrtN
			});
		}		
		return points;
	}

	function gaussianDistribution(mu, sigma) {
		return function (x) {
			var gaussianConstant = 1 / Math.sqrt(2 * Math.PI);

			x = (x - mu) / sigma;
			return gaussianConstant * Math.exp(-.5 * x * x) / sigma;
		};
	}

	function groundTruthMixedNormalDistribution(x) {
		return 7/10 * gaussianDistribution(1, 1)(x) + 
		3/10 * gaussianDistribution(5, 1)(x);
	}

	function getDensityRMSE(dataPoints, compareFunc) {
		var MSE = 0;
		dataPoints.forEach(function (point) {
			var x = point[0];
			var y = point[1];
			MSE += Math.pow(y - compareFunc(x), 2);
		});
		return Math.sqrt(MSE);
	}

	function getHistogramRMSE(histogramData, compareFunc) {
		/*var minX = histogramData[0].x;
		var lastElement = histogramData[histogramData.length - 1];
		var maxX = lastElement.x + lastElement.dx;
		densityTicksInterval = densityTicks.filter(function (tick) {
			return tick >= minX && tick < maxX;
		});*/
		var dataPoints = xDataTicks.map(function (x) {
			var y = 0;
			for (var i = 0; i < histogramData.length; i++) {
				var el = histogramData[i];
				if (x < el.x) {
					break;
				}
				if (el.x + el.dx > x) {
					y = el.y / el.dx;
					break;
				}
			}
			return [x, y];
		});
		return getDensityRMSE(dataPoints, compareFunc);
	}

	function createGroundTruthData() {
		xDataTicks.forEach(function (tick) {
			var x = tick;
			var y = groundTruthMixedNormalDistribution(tick);
			var el = [x, y];
            data.push(el);
		});
	}

	function getKullbackLeiblerDivergence(estimationFunc, groundTruthFunc) {
		var sum = 0;
		for (var i = 0; i < estimationFunc.length - 1; i++) {
			var point = estimationFunc[i];
			var x = point[0];
			var y = point[1];
			var p = groundTruthFunc(x);
			var q = y;
			if (p != 0 && q != 0) {
				var nextPoint = estimationFunc[i + 1];
				var nextPointX = nextPoint[0];
				var dx = nextPointX - x;
				sum += p * Math.log2(p / q) * dx;
			}
		}
		return sum;
	}

	function getSigmaHat(sample) {
		var mean = d3.mean(sample);
		var sum = d3.sum(sample, function(x) {
			return Math.pow(x - mean, 2);
		});
		var n = sample.length;
		return Math.sqrt(sum / (n - 1));
	}

	function getIntegralData(densityData) {
		var firstX = densityData[0][0];
		var integralFunc = [[firstX, 0]];
		for (var i = 1; i < densityData.length; i++) {
			var point = densityData[i];
			var x = point[0];
			var y = point[1];
			var integralBefore = integralFunc[i - 1];
			var xIntegralBefore = integralBefore[0];
			var yIntegralBefore = integralBefore[1];
			var dx = x - xIntegralBefore;
			var integralNew = yIntegralBefore + y * dx;
			integralFunc[i] = [x, integralNew];
		}
		return integralFunc;
	}

	function getDiffFromDensityIntegralAndCDF(cdfData, integralData) {
		var diff = 0;
		var j = 0;
		//csvLog("cdfData", cdfData);
		//csvLog("integralData", integralData);
		for (var i = 1; i < integralData.length - 1; i++) {
			var integralPoint = integralData[i];
			var integralPointX = integralPoint[0];
			var integralPointY = integralPoint[1];
			var integralPointDX = integralData[i + 1][0] - integralPointX;
			for (; j < cdfData.length - 1; j++) {
				var cdfNextPoint = cdfData[j + 1];
				var cdfNextPointX = cdfNextPoint[0];
				if (cdfNextPointX > integralPointX) {
					break;
				}
			}
			//csvLog("j", j);
			var cdfPoint = cdfData[j];
			var cdfPointY = cdfPoint[1];
			diff += (cdfPointY - integralPointY) * integralPointDX;
		}
		return Math.abs(diff);
	}

    var histQ=HISTOGRAMQ;
    var logScaleBase=1;  // use =LOGSCALEBASE to start as log scale
    var showCdf = SHOWCDF;
    var showDensity = SHOWDENSITY;
	var densityData = null;
	var integralData;
	var cdfData = null;
    var y2Scale = null;

    initStatic(svg);
    addControls($elem);
    redraw();
}