/**
 * @file MMM-Strava.js
 *
 * @author ianperrin
 * @license MIT
 *
 * @see  https://github.com/ianperrin/MMM-Strava
 */

/* global Module, config, Log, moment */

Module.register("MMM-Strava", {
    // Set the minimum MagicMirror module version for this module.
    requiresVersion: "2.2.0",
    // Default module config.
    defaults: {
        client_id: "",
        client_secret: "",
        mode: "chart",                                  // Possible values "table", "chart", "progressbar"
        activities: ["ride", "run", "swim"],            // Possible values "ride", "run", "swim"
        period: "recent",                               // Possible values "recent", "ytd", "all"
        stats: ["count", "distance", "pace", "achievements"],   // Possible values "count", "distance", "pace", "elevation", "moving_time", "elapsed_time", "achievements"
        auto_rotate: true,                              // Rotate stats through each period starting from specified period
        locale: config.language,
        units: config.units,
        fetchInterval: 15 * 60 * 1000,                  // every 15 minutes
        updateInterval: 2 * 60 * 1000,                 // 2 minutes
        animationSpeed: 1 * 1000,                     // 2.5 seconds
        runningGoal: 750,
        showProgressBar: false,
        shownPB: "ride",                                //will revolve between all progressbars with a goal
        goals: {
          "ride": 1000,
          "run": 750,
          "swim": 0,
        },
        showCrowns: true,
        showRecords: false,
        distances: {
          "400m": 400,
          "1k": 1000,
          "5k": 5000,
          "10k": 10000,
          "HM": 21097,
        },
        showYearlies: false,
        interval: {
          show: true,
          activities: ["Run", "Ride"],
          name: "year"
        },
        debug: true,                                    // Set to true to enable extending logging
    },

    /**
     * @member {boolean} loading - Flag to indicate the loading state of the module.
     */
    loading: true,
    /**
     * @member {boolean} rotating - Flag to indicate the rotating state of the module.
     */
    rotating: false,
    activityList: [],
    segmentList: [],
    stats: [],
    rankings: [],
    yearlies: [],
    records: new Object({}),

    getStyles: function() {
        return ["font-awesome.css", "MMM-Strava.css"];
    },

    getScripts: function() {
        return [
          "moment.js",
          "modules/MMM-Strava/node_modules/moment-duration-format/lib/moment-duration-format.js",
          "modules/MMM-Strava/node_modules/chart.js/dist/Chart.bundle.js",
          "modules/MMM-Strava/node_modules/lodash/core.js"
        ];
    },
    /**
     * @function getTranslations
     * @description Translations for this module.
     * @override
     *
     * @returns {Object.<string, string>} Available translations for this module (key: language code, value: filepath).
     */
    getTranslations: function() {
        return {
            en: "translations/en.json",
            nl: "translations/nl.json",
            de: "translations/de.json",
            id: "translations/id.json",
            hu: "translations/hu.json"
        };
    },

    start: function() {
        Log.info("Starting module: " + this.name);
        // Validate config
        this.config.mode = this.config.mode.toLowerCase();
        this.config.period = this.config.period.toLowerCase();
        // Add custom filters
        this.addFilters();
        // Initialise helper and schedule api calls
        this.log("Sending socket notification GET_DATA");
        this.sendSocketNotification("GET_STRAVA_DATA", this.config);
        this.scheduleUpdates();
    },


    socketNotificationReceived: function(notification, payload) {
        this.log(`Receiving notification: ${notification}`);
        if (notification === "STATS") {
            if (!_.isEmpty(payload)) { this.stats = payload; }
            //this.log("Athlete stats: "+JSON.stringify(this.stats));
            //this.updateDom(this.config.animationSpeed);
        } else if (notification === "ACTIVITIES") {
            this.activityList = payload;
            //this.log("Athlete activities: "+JSON.stringify(this.activityList));
            this.yearlies = this.getYearlies(this.activityList);
            //this.drawYearliesChart(this.yearlies);
            //this.weeklyScore = this.getWeeklyScore(this.activityList);
        } else if (notification === "CROWNS") {
            this.rankings = payload;
            this.log("Received Rankings: "+this.rankings);
            this.loading = false;
        } else if (notification === "RECORDS") {
            this.records = payload;
            //this.log("Received Records: "+this.records);
        } else if (notification === "ERROR") {
            //this.loading = false;
            this.error = payload.data.message;
        } else if (notification === "WARNING") {
            this.sendNotification("SHOW_ALERT", {type: "notification", title: payload.data.message});
        }
    },


    getTemplate: function() {
        return "templates\\MMM-Strava.njk";
    },


    getTemplateData: function() {
        moment.locale(this.config.language);
        this.log("Updating template data");
        return {
            config: this.config,
            loading: this.loading,
            error: this.error || null,
            stats: this.stats || {},
            activities: this.activityList || {},
            chart: {bars: this.config.period === "ytd" ? moment.monthsShort() : moment.weekdaysShort() },
            rankings: this.rankings || {},
            records: this.records || {},
            /*progressBar: {
                "run": this.addMeasure(this.stats.ytd_run_totals.distance || 0, "run"),
                "ride": this.addMeasure(this.stats.ytd_ride_totals.distance || 0, "ride"),
                "swim": this.addMeasure(this.stats.ytd_swim_totals.distance || 0, "swim")
            }*/
        };
    },




    scheduleUpdates: function() {
        var self = this;
        var toggler = 0;
        // Schedule module rotation
        if (this.config.auto_rotate && this.config.updateInterval) {
          setInterval(function() {
            // Get next period
            self.config.period = ((self.config.period === "recent") ? "ytd" : ((self.config.period === "ytd") ? "all" : "recent"));
            self.config.shownPB = ((self.config.shownPB === "ride" && self.config.goals.run) ? "run" : ((self.config.shownPB === "run" && self.config.goals.swim) ? "swim" : "ride"));
            self.updateDom(self.config.animationSpeed);
            setTimeout(function() {
              var int = self.config.interval;
              self.createBarChart(int.activities[toggler % int.activities.length], int.name);
            }, 2000);
            toggler = (toggler == 9) ? 0 : toggler + 1;
          }, this.config.updateInterval);
        }
    },


    log: function(msg) {
        if (this.config && this.config.debug) {
            Log.info(`${this.name}: ` + JSON.stringify(msg));
        }
    },


    addFilters() {
        var env = this.nunjucksEnvironment();
        env.addFilter("getIntervalClass", this.getIntervalClass.bind(this));
        env.addFilter("getLabel", this.getLabel.bind(this));
        env.addFilter("formatTime", this.formatTime.bind(this));
        env.addFilter("formatDistance", this.formatDistance.bind(this));
        env.addFilter("formatElevation", this.formatElevation.bind(this));
        env.addFilter("roundValue", this.roundValue.bind(this));
    },


    getIntervalClass: function(interval)
    {
        moment.locale(this.config.locale);
        var currentInterval = this.config.period === "ytd" ? moment().month() : moment().weekday();
        var className = "future";
        if (currentInterval === interval) {
            className = "current";
        } else if (currentInterval > interval) {
            className = "past";
        }
        return className;
    },


    getLabel: function(interval) {
        moment.locale(this.config.locale);
        const startUnit = this.config.period === "ytd" ? "year" : "week";
        const intervalUnit = this.config.period === "ytd" ? "months" : "days";
        const labelUnit = this.config.period === "ytd" ? "MMM" : "dd";
        var intervalDate = moment().startOf(startUnit).add(interval, intervalUnit);
        return intervalDate.format(labelUnit).slice(0,1).toUpperCase();
    },


    formatTime: function(timeInSeconds) {
        return moment.duration(timeInSeconds, "seconds").format();
        /*var duration = moment.duration(timeInSeconds, "seconds");
        //console.log("Duration: "+duration);
        if (duration > 3599000) {
          return Math.floor(duration.hours()) + ":" + duration.minutes()+":"+duration.seconds();
        } else if (duration > 59000) {
          return (duration.minutes()+":"+duration.seconds());
        } else {
          return duration.seconds() + "s";
        }*/
    },


    formatDistance: function(value, digits, showUnits) {
        const distanceMultiplier = this.config.units === "imperial" ? 0.0006213712 : 0.001;
        const distanceUnits = this.config.units === "imperial" ? " mi" : " km";
        return this.formatNumber(value, distanceMultiplier, digits, (showUnits ? distanceUnits : null));
    },


    formatElevation: function(value, digits, showUnits) {
        const elevationMultiplier = this.config.units === "imperial" ? 3.28084 : 1;
        const elevationUnits = this.config.units === "imperial" ? " ft" : " m";
        return this.formatNumber(value, elevationMultiplier, digits, (showUnits ? elevationUnits : null));
    },


    // formatNumber
    formatNumber: function(value, multipler, digits, units) {
        // Convert value
        value = value * multipler;
        // Round value
        value = this.roundValue(value, digits);
        // Append units
        if (units) {
            value += units;
        }
        return value;
    },


    roundValue: function(value, digits) {
      var rounder = Math.pow(10, digits);
      return (Math.round(value * rounder) / rounder).toFixed(digits);
    },


    /**
     * @function addMeasure
     * @description adds progress bar parameters to show comparative progress.
     *
     */
    addMeasure: function(distance, sport) {
      var partOfYear = (moment().dayOfYear() / moment().endOf("year").dayOfYear());
      var toMeasure = Math.round( 510 * (1 - partOfYear));

      var reached = (distance / (this.config.goals[sport] * 1000));
      // Calculate the percentage of the total length
      var toRes = Math.round( 510 * (1 - reached));
      //this.log("New offset: "+to);

      var distToMeasure = Math.round(partOfYear * this.config.goals[sport] * 1000);
      var deviation = distance - distToMeasure;
      //return progress bar parameters
      return({
        "toMeasure": Math.max(0, toMeasure),
        "offset": Math.max(0, toRes),
        "deviation": deviation,
        "color": (deviation < 0) ? "red" : "green",
        "threshold": Math.round(-510 * partOfYear),
        "distance": distance,
      });
    },

    getYearlies: function(activityList) {
      var thisYear = moment().year();
      var startYear = thisYear - 4;
      var year, week, actType;
      var yearlies = {
        "Run": {},
        "Ride": {},
        "Swim": {}
      };
      var distances = {};
      for (var act in yearlies) {
        for (var y = startYear; y < thisYear+1; y++) {
          yearlies[act][y] = {
            "cum": 0
          };
          /*for (var w = 1; w < 53; w++) {
            yearlies[act][y][w] = 0
          }*/
        }
      }
      //console.log("Yearlies: "+JSON.stringify(yearlies));
      for (var a = 0; a < activityList.length; a++) {
        year = moment(activityList[a].start_date).year();
        if (year >= startYear) {
          actType = (activityList[a].type);
          week = moment(activityList[a].start_date_local).week();
          if (yearlies.hasOwnProperty(actType)) {
            yearlies[actType][year][week] = yearlies[actType][year].cum += Math.round(activityList[a].distance);
          }
        }
      }
      console.log("Yearlies: "+JSON.stringify(yearlies));
      return(yearlies);
    },

    drawYearliesChart: function(yearlies) {
      //var yearliesChart = new Chart();
      var yChartData = {};
      yChartData.labels = [];
      yChartData.datasets = [];
      for (var y in yearlies.Run) {
        var sData = [];
        for (var d in yearlies.Run[y]) {
          sData.push({
            x: d,
            y: yearlies.Run[y][d],
          });
        }
        this.log("sdata: "+JSON.stringify(sData));
        yChartData.datasets.push({
          label: y,
          data: sData,
          showLine: true,
          fill: false,
          bordercolor: 'rgba(0, 200, 0, 1)',
        });
        this.log("yChartData: "+JSON.stringify(yChartData));
      }
    },


    getWeeklyScore: function(activityList) {
      var weeklyScore = [];
      var firstWeek = moment().subtract(13, 'weeks').startOf('week');
      console.log(firstWeek);
      /*var actIndex = activityList.findIndex(index => function(element, index) {
        return (moment(element[index].start_date_local).startOfWeek() >= firstWeek)
        });
      console.log(actIndex);
      activityList = activityList.slice(actIndex);
      console.log (activityList);*/
      var weekCount = 0;
      for (var act in activityList) {
        this.weeklyScore[(moment(act.start_date_local).week() - moment(firstWeek).week())] += act.suffer_score;
      }
      console.log("Weeklies: "+this.weeklyScore);
    },


    createBarChart: function(actType, interval) {
      var startDate = (interval == "week") ? moment().subtract(6, "days").startOf("day") : moment().subtract(11, "months").startOf("month");
      //this.log("Start Date for bars: "+startDate.format());
      var bgActivities = this.activityList.filter(function (item) {
        return((item.type == actType) && (moment(item.start_date_local) > startDate));
      });
      //this.log("bgActivities: "+JSON.stringify(bgActivities));

      var labels = [];
      var values = [];
      var dateLabel = startDate.clone();
      while (dateLabel < moment()) {
        if (interval == "week") {
          labels.push(dateLabel.format("dd"));
          dateLabel = dateLabel.add(1, "days");
        } else if (interval == "year") {
          labels.push(dateLabel.format("MMM"));
          dateLabel = dateLabel.add(1, "months");
        }
        values.push(0);
      }
      //this.log("DateLabels: "+labels);

      for (i = 0; i < bgActivities.length; i++) {
        if (interval == "week") {
          values[moment(bgActivities[i].start_date_local).diff(startDate, 'days')] += (bgActivities[i].distance/1000);
        } else {
          values[moment(bgActivities[i].start_date_local).diff(startDate, 'months')] += (bgActivities[i].distance/1000);
        }
      }
      //this.log("Values: "+values);

      var intChart = document.getElementById("intervalChart");
      intChart.style.display = "block";
      intChart.height = 300;
      intChart.width = 300;
      var ctx = intChart.getContext("2d");
      var barChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              backgroundColor: 'rgba(0, 0, 0, 0.1)',
              data: values,
              borderColor: 'rgba(200, 200, 200, 0.8)', /*function (context) {
                var index = context.dataIndex;
                return (index == context.data.length-1) ? 'rgba(173, 216, 230, 1)' : 'rgba(200, 200, 200, 0.8)';
              },*/
              borderWidth: 1,
              label: labels
            }
          ]
        },
        options: {
          scales: {
            yAxes: [{
              ticks: {
                beginAtZero: true
              }
            }],
            xAxes: [{
              ticks: {
                fontSize: 22,
              }
            }]
          },
          responsive: false,
          legend: { display: false },
          title: {
            display: true,
            text: "Last 7 days"
          },
        }
      });
      intChart.datasets[0].bars[intChart.datasets[0].bars.length-1].borderColor = 'rgba(173, 216, 230, 1)';
    }
});
