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
        period: "recent",                               // Possible values "recent", "ytd", "all"
        locale: config.language,
        units: config.units,
        fetchInterval: 15 * 60 * 1000,                 //every 15 minutes
        pauseFetching: [0, 7],                         // pause during night
        updateInterval: 2 * 60 * 1000,                 // 2 minutes
        animationSpeed: 1 * 1000,                      // 2.5 seconds
        gridColumns: 3,
        subModules: {
          "statsTable": 1,
          "crowns": 1,
          "records": 1,
          "relativeEffort": 1,
          "yearlies": 1,
          "interval": 1,
          "recent": 0,
          "progressBar": 0
        },
        statsTable: {
          show: false,
          stats: ["count", "distance", "pace", "achievements"],   // Possible values "count", "distance", "pace", "elevation", "moving_time", "elapsed_time", "achievements"
          auto_rotate: true,                              // Rotate stats through each period starting from specified period
          activities: ["ride", "run", "swim"],            // Possible values "ride", "run", "swim"
          periods: ["recent", "ytd", "all"]
        },
        progressBar: {
          show: false,
          shownPB: "ride",                               //will revolve between all progressbars with a goal
          goals: {
            "ride": 1000,
            "run": 750,
          },
        },
        crowns: {
          show: false,
        },
        records: {
          show: false,
          distances: {
            "400m": 400,
            "1k": 1000,
            "5k": 5000,
            "10k": 10000,
            "HM": 21097,
          },
        },
        relativeEffort: {
          show: false,
          shownWeeks: 8,
        },
        yearlies: {
          show: false,
          activities: ["Run", "Ride"],
          shownYears: 4
        },
        interval: {
          show: false,
          activities: ["Run", "Ride"],
          name: "year"
        },
        recent: {
          show: false,
          activities: ["Run", "Ride"],
          activitiesToCompare: 10,				//number of recent activities to compare against
        },
        debug: true,                                    // Set to true to enable extended logging
    },

    /**
     * @member {boolean} loading - Flag to indicate the loading state of the module.
     */
    loading: true,
    /**
     * @member {boolean} rotating - Flag to indicate the rotating state of the module.
     */
    rotating: false,
    toggler: -1,		//toggler will count from 0 to 9 with every dom update and define the activity to show for every sub-module (see this.scheduleupdates)
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
          "modules/MMM-Strava/node_modules/chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.js",
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
        this.config.period = this.config.period.toLowerCase();
        //set visibility of chosen subModules
        this.log(this.config.submodules);
        for (var mod in this.config.subModules) {
          if (this.config.subModules[mod] == 1) {
            if (this.config[mod]) {
              this.config[mod].show = true;
            } else {
              this.log("ERROR: Submodule does not exist: "+mod);
            }
          }
        }
        // Add custom filters
        this.addFilters();
        Chart.plugins.unregister(ChartDataLabels);
        // Initialise helper and schedule api calls
        this.log("Sending socket notification GET_DATA");
        this.log(this.config);
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
        moment.updateLocale('de', {
          monthsShort : 'Jan_Feb_Mrz_Apr_Mai_Jun_Jul_Aug_Sep_Oct_Nov_Dez'.split('_'),
        });
        moment.locale(this.config.language);
        this.log("Updating template data");
        this.log("Toggler: "+this.toggler);
        return {
            config: this.config,
            loading: this.loading,
            toggler: this.toggler,
            error: this.error || null,
            stats: this.stats || {},
            activities: this.activityList || {},
            chart: {bars: this.config.period === "ytd" ? moment.monthsShort() : moment.weekdaysShort() },
            rankings: this.rankings || {},
            records: this.records || {},
            recent: (this.activityList.length) ? this.prepareRecent(this.activityList, this.config.recent.activities[this.toggler % this.config.recent.activities.length]) : {},
            /*progressBar: {
                "run": this.addMeasure(this.stats.ytd_run_totals.distance || 0, "run"),
                "ride": this.addMeasure(this.stats.ytd_ride_totals.distance || 0, "ride"),
                "swim": this.addMeasure(this.stats.ytd_swim_totals.distance || 0, "swim")
            }*/
        };
    },




    scheduleUpdates: function() {
        var self = this;
        // Schedule module rotation
        if (this.config.auto_rotate && this.config.updateInterval) {
          setInterval(function() {
            var int = self.config.interval;
            self.toggler = (self.toggler == 9) ? 0 : self.toggler + 1;
            self.config.period = self.config.statsTable.periods[self.toggler % self.config.statsTable.periods.length];
            //self.config.progressBar.shownPB = ((self.config.pogressBar.shownPB === "ride" && self.config.progressBar.goals.run) ? "run" : ((self.config.shownPB === "run" && self.config.goals.swim) ? "swim" : "ride"));
            self.updateDom(self.config.animationSpeed)
            /*.then(function() {
              self.createBarChart(int.activities[toggler % int.activities.length], int.name);
              self.createWeeklyEffortChart(self.activityList);
              self.createYearliesChart("Run", self.activityList);
            })*/
            ;
            setTimeout(function() {
              self.createBarChart(int.activities[self.toggler % int.activities.length], int.name);
              self.createWeeklyEffortChart(self.activityList);
              self.createYearliesChart("Run", self.activityList);
            }, 2000);
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


    formatPace: function(activity, distance, time) {
      var factor = (this.config.units == "metric") ? 1000 : 1609.34;
      if (activity == "Run") {
        distance = distance / factor;
        //moment.js "hack" to convert pace into m:ss. The number of seconds is added to start of the day (0:00) and the new "time is converted"
        pace = moment().startOf("day").seconds(Math.round(time / distance)).format("m:ss");
      } else if (activity == "Swim") {
        distance = (this.config.units == "metric") ? (distance / 100) : (distance / 100 * 0.9144);
        pace = moment().startOf("day").seconds(Math.round(time / distance)).format("m:ss");
      } else {
        distance = distance / factor * 1000;
        pace = ( distance / time * 3.6).toFixed(1);
      }
      return pace;
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

    prepareRecent: function(activityList, activity) {
      //activityList.reverse();
      var factor = (this.config.units == "metric") ? 1000 : 1609.34;
      var compares = this.activityList.filter(item => {
        return(item.type == activity);
      });
      this.log(compares.length);
      compares = compares.slice(-this.config.recent.activitiesToCompare).reverse();
      this.log(compares.length);
      var compareStats = {
        distance: 0,
        elapsedTime: 0,
        movingTime: 0,
        elevation: 0,
        pace: 0,
      };
      for (c = 0; c < compares.length ; c++) {
        compareStats.distance += compares[c].distance;
        compareStats.elapsedTime += compares[c].elapsed_time;
        compareStats.movingTime += compares[c].moving_time;
        compareStats.elevation += compares[c].total_elevation_gain;
      }
      //compareStats.distance = compareStats.distance / compares.length;
      compareStats.elevation = Math.round(compareStats.elevation / compares.length);
      compareStats.medDistance = (compareStats.distance / compares.length);
      compareStats.pace = this.formatPace(activity, compareStats.distance, compareStats.movingTime);

      var recentAct = [];
      for (c = 0; c < 3; c++) {
        recentAct.push({
          name: compares[c].name,
          date: moment(compares[c].start_date_local).format("DD.MM. h:mm"),
          distance: compares[c].distance,
          distanceTrend: (compares[c].distance > compareStats.medDistance) ? "up" : "down",
          movingTime: compares[c].moving_time,
          elevation: compares[c].total_elevation_gain,
          elevationTrend: (compares[c].total_elevation_gain > compareStats.elevation) ? "up" : "down",
          elapsedTime: compares[c].elapsed_time,
          pace: this.formatPace(compares[c].type, compares[c].distance, compares[c].moving_time),
          paceTrend: (compares[c].pace < compareStats.pace) ? "up" : "down"
        });
      }

      var recentData = {
        recentAct: recentAct,
        //compares: compares,
        compareStats: compareStats,
      };
      this.log("Recent: "+JSON.stringify(recentData));
      return recentData;
    },



    createYearliesChart: function(activity, activityList) {
      var yChartData = {};
      yChartData.labels = [1,2,3,4,5,6,7,8,9,10,11,12,13,1,4,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53];
      yChartData.datasets = [];

      var thisYear = moment().year();
      var startYear = thisYear - this.config.yearlies.shownYears + 1;
      var year = startYear;
      var week;
      var weeklyCount = Array(moment(year, "YYYY").weeksInYear()).fill(0);
      this.log(weeklyCount.length, weeklyCount);
      this.log("Fetching yearly data for "+activity+" starting "+year);
      //this.log(weeklyCount);
      var actList = activityList.filter(element =>
      {
        return ((moment(element.start_date_local).year() >= startYear) && (element.type == activity));
      });
      //this.log(JSON.stringify(actList));
      //activityList = activityList.slice(actIndex);

      for (var a = 0; a < actList.length; a++) {

        //first, push old values to new dataset if a new year is being started
        if (moment(actList[a].start_date_local).year() != year) {
          //console.log("New year: "+moment(activityList[a].start_date_local).year());
          //this.log(weeklyCount);
          for (var w = 1; w < weeklyCount.length; w++) {
            weeklyCount[w] += weeklyCount[w-1];
          }
          var greyscale = 100 + 50 * (year - startYear);
          var gsString = 'rgba('+greyscale+','+greyscale+','+greyscale+', 1)';
          //console.log("WeeklyCount: "+year+" "+weeklyCount);
          //console.log("Pushing yearly!");
          yChartData.datasets.push({
            label: year,
            data: weeklyCount,
            pointRadius: 0,
            //showLine: true,
            fill: false,
            steppedLine: true,
            borderColor: gsString,
            borderWidth: 2
          });
          year = moment(actList[a].start_date_local).year();
          weeklyCount = (moment().year() === year) ? Array(moment().week()).fill(0) : Array(moment(year, "YYYY").weeksInYear()).fill(0);
        }
        week = moment(actList[a].start_date_local).week();
        if ((moment(actList[a].start_date_local).dayOfYear() < 6) && (week > 51)) { week = 1; } //hack to ensure first activities in a year being in "week 1" of the year.
        weeklyCount[week-1] += (activity === "Run") ? actList[a].distance / 1000 : actList[a].distance;
      }
      //this.log(weeklyCount);
      if (year === thisYear) {
        for (var w = 1; w < moment().week(); w++) {
          weeklyCount[w] += weeklyCount[w-1];
        }
      } else {
        for (var w = 1; w < weeklyCount.length; w++) {
          weeklyCount[w] += weeklyCount[w-1];
        }
      }
      //console.log("WeeklyCount: "+year+" "+weeklyCount);
      //console.log("Pushing yearly!");
      yChartData.datasets.push({
        label: year,
        data: weeklyCount,
        pointRadius: 0,
        //showLine: true,
        fill: false,
        steppedLine: true,
        borderColor: 'rgba(50, 200, 50, 1)',
        borderWidth: 2
      });
      //this.log("Chart Data: "+JSON.stringify(yChartData));

      var yearChart = document.getElementById("yearChart");
      yearChart.style.display = "block";
      yearChart.height = 250;
      yearChart.width = 340;

      var yctx = yearChart.getContext("2d");
      var yChart = new Chart(yctx, {
        type: 'line',
        data: yChartData,
        options: {
          //steppedLine: true,
          scales: {
            yAxes: [{
              //display: false,
              ticks: {
                beginAtZero: true,
                fontSize: 20,
                fontColor: "#DDD"
              }
            }],
            xAxes: [{
              ticks: {
                display: false,
                fontSize: 20,
                autoSkip: true,
                minRotation: 90,
                maxRotation: 90,
                fontColor: "#DDD"
              }
            }]
          },
          legend: {
            display: false
          },
          title: {
            display: false,
          },
        }
      });
      //this.log(yChart);
    },


    createWeeklyEffortChart: function(activityList) {
      var weeklyScore = new Array(this.config.relativeEffort.shownWeeks).fill(0);
      this.log("Weeklies: "+weeklyScore);
      var firstWeek = moment().subtract(this.config.relativeEffort.shownWeeks-1, 'weeks').startOf('week');
      console.log(firstWeek.format());
      var actIndex = activityList.findIndex( element => {
        return (moment(element.start_date_local).startOf('week') >= firstWeek);
      });
      //console.log(actIndex);
      activityList = activityList.slice(actIndex);
      var weekCount = 0;
      for (i = 0; i < activityList.length; i++) {
        weekCount = moment(activityList[i].start_date_local).diff(firstWeek, "weeks");
        //console.log("WeekCount: "+weekCount);
        weeklyScore[weekCount] += activityList[i].suffer_score;
      }
      console.log("Weeklies: "+weeklyScore);

      var weeks = [];
      for (w = 0; w < weeklyScore.length; w++) {
        weeks.push(firstWeek.add(w, "weeks").week());
      }

      var weeklyChart = document.getElementById("weeklyChart");
      weeklyChart.style.display = "block";
      weeklyChart.height = 250;
      weeklyChart.width = 340;

      //create array for colored bar graphs, last one is blue
      var colorArray = [];
      for (var c = 0; c < (weeklyScore.length - 1); c++) { colorArray.push('rgba(200, 200, 200, 0.8)'); }
      colorArray.push('rgba(173, 216, 230, 1)');

      var ctx = weeklyChart.getContext("2d");
      var wklyChart = new Chart(ctx, {
        type: 'line',
        plugins: [ChartDataLabels],
        data: {
          labels: weeks,
          datasets: [
            {
              backgroundColor: 'rgba(50, 50, 50, 0.5)',
              data: weeklyScore,
              borderColor: colorArray,
              borderWidth: 2,
              fill: false,
              lineTension: 0,
              pointRadius: 4,
              pointBorderWidth: 3,
              pointBackgroundColor: 'rgba(0, 0, 0, 0.5)',
              showLine: false,
            }
          ]
        },
        options: {
          layout: {
            padding: {
              left: 0,
              right: 8,
              top: 0,
              bottom: 0
            }
          },
          scales: {
            yAxes: [{
              //display: false,
              ticks: {
                suggestedMax: 400,
                fontSize: 19,
                beginAtZero: true,
              }
            }],
            xAxes: [{
              ticks: {
                display: false,
                fontSize: 20,
                fontColor: "#BBB"
              }
            }]
          },
          plugins: {
            datalabels: {
              color: '#ddd',
              formatter: Math.round,
              font: {
                size: 19,
              },
              anchor: 'end',
              align: 'top',
              clip: false,
              offset: 7
            },
          },

          //responsive: false,
          legend: { display: false },
          title: {
            display: false,
          },
        }
      });
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

      // summarise activity distances to weekly/monthly numbers
      for (i = 0; i < bgActivities.length; i++) {
        if (interval == "week") {
          values[moment(bgActivities[i].start_date_local).diff(startDate, 'days')] += (bgActivities[i].distance/1000);
        } else {
          values[moment(bgActivities[i].start_date_local).diff(startDate, 'months')] += (bgActivities[i].distance/1000);
        }
      }

      //round values <- can this additional for-loop be spared?
      /*for (i = 0; i < values.length; i++) {
        values[i] = Math.round(values[i]);
      }*/

      //this.log("Values: "+values);

      var intChart = document.getElementById("intervalChart");
      intChart.style.display = "block";
      intChart.height = 250;
      intChart.width = 340;

      //create array for colored bar graphs, last one is blue
      var colorArray = [];
      for (var c = 0; c < (values.length - 1); c++) { colorArray.push('rgba(200, 200, 200, 0.8)'); }
      colorArray.push('rgba(173, 216, 230, 1)');

      //Chart.plugins.register(ChartDataLabels);
      var ctx = intChart.getContext("2d");
      var barChart = new Chart(ctx, {
        type: 'bar',
        plugins: [ChartDataLabels],
        data: {
          labels: labels,
          datasets: [
            {
              backgroundColor: 'rgba(100, 100, 100, 0.6)',
              data: values,
              borderColor: colorArray,
              borderWidth: 3,
              label: labels
            }
          ]
        },
        options: {
          layout: {
            padding: {
              top: 5,
            }
          },
          scales: {
            yAxes: [{
              display: false,
              ticks: {
                beginAtZero: true,
              }
            }],
            xAxes: [{
              ticks: {
                fontSize: 18,
                autoSkip: false,
                minRotation: 90,
                maxRotation: 90,
                fontColor: "#DDD"
              }
            }]
          },
          plugins: {
            datalabels: {
              color: '#ddd',
              formatter: Math.round,
              font: {
                size: 19,
              },
              anchor: 'end',
              align: 'top',
              clip: false,
              //offset: 5
            },
          },
          legend: {
            display: false
          },
          title: {
            display: false,
          },
        }
      });
    }
});
