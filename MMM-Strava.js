



/**
 * @file MMM-Strava.js
 *
 * @author ianperrin
 * @license MIT
 *
 * @see  https://github.com/ianperrin/MMM-Strava
 */

/* global Module, config, Log, moment */

/**
 * @external Module
 * @see https://github.com/MichMich/MagicMirror/blob/master/js/module.js
 */

/**
 * @external config
 * @see https://github.com/MichMich/MagicMirror/blob/master/config/config.js.sample
 */

/**
 * @external Log
 * @see https://github.com/MichMich/MagicMirror/blob/master/js/logger.js
 */

/**
 * @external moment
 * @see https://www.npmjs.com/package/moment
 */

/**
 * @module MMM-Strava
 * @description Frontend of the MagicMirror² module.
 *
 * @requires external:Module
 * @requires external:config
 * @requires external:Log
 * @requires external:moment
 */
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
        stats: ["count", "distance", "achievements"],   // Possible values "count", "distance", "elevation", "moving_time", "elapsed_time", "achievements"
        auto_rotate: false,                             // Rotate stats through each period starting from specified period
        locale: config.language,
        units: config.units,
        reloadInterval: 16 * 60 * 1000,                  // every 16 minutes
        updateInterval: 60 * 60 * 1000,                 // 1 hour
        animationSpeed: 2.5 * 1000,                     // 2.5 seconds
        runningGoal: 750,
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
    /**
     * @function getStyles
     * @description Style dependencies for this module.
     * @override
     *
     * @returns {string[]} List of the style dependency filepaths.
     */
    getStyles: function() {
        return ["font-awesome.css", "MMM-Strava.css"];
    },
    /**
     * @function getScripts
     * @description Script dependencies for this module.
     * @override
     *
     * @returns {string[]} List of the script dependency filepaths.
     */
    getScripts: function() {
        return ["moment.js"];
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
    /**
     * @function start
     * @description Validates config values, adds nunjuck filters and initialises requests for data.
     * @override
     */
    start: function() {
        Log.info("Starting module: " + this.name);
        // Validate config
        this.config.mode = this.config.mode.toLowerCase();
        this.config.period = this.config.period.toLowerCase();
        // Add custom filters
        this.addFilters();
        // Initialise helper and schedule api calls
        console.log("Sending Socket notification SET-CONFIG");
        this.sendSocketNotification("GET_STRAVA_DATA", {"identifier": this.identifier, "config": this.config});
        //this.scheduleUpdates();
    },
    /**
     * @function socketNotificationReceived
     * @description Handles incoming messages from node_helper.
     * @override
     *
     * @param {string} notification - Notification name
     * @param {Object,<string,*} payload - Detailed payload of the notification.
     */
    socketNotificationReceived: function(notification, payload) {
        this.log(`Receiving notification: ${notification} for ${payload.identifier}`);
        if (payload.identifier === this.identifier) {
            if (notification === "DATA") {
                this.data = payload.data;
                //this.log("Strava data: "+JSON.stringify(this.data));
                this.loading = false;
                this.updateDom(this.config.animationSpeed);
            } else if (notification === "ERROR") {
                this.loading = false;
                this.error = payload.data.message;
                this.updateDom(this.config.animationSpeed);
            } else if (notification === "WARNING") {
                this.loading = false;
                this.sendNotification("SHOW_ALERT", {type: "notification", title: payload.data.message});
            }
        }
    },
    /**
     * @function getTemplate
     * @description Nunjuck template.
     * @override
     *
     * @returns {string} Path to nunjuck template.
     */
    getTemplate: function() {
        return "templates\\MMM-Strava." + this.config.mode + ".njk";
    },

    /**
     * @function getTemplateData
     * @description Data that gets rendered in the nunjuck template.
     * @override
     *
     * @returns {string} Data for the nunjuck template.
     */
    getTemplateData: function() {
        moment.locale(this.config.locale);
        //console.log("Data: "+JSON.stringify(this.data));
        //console.log("ytd Distance: "+this.data.ytd_run_totals.distance / 1000);
        return {
            config: this.config,
            loading: this.loading,
            error: this.error || null,
            data: this.data || {},
            chart: {bars: this.config.period === "ytd" ? moment.monthsShort() : moment.weekdaysShort() },
            //barOffset: Math.round(this.addOffset(this.data.ytd_run_totals.distance / 1000))
        };
    },
    /**
     * @function scheduleUpdates
     * @description Schedules table rotation
     */
    scheduleUpdates: function() {
        var self = this;
        // Schedule table rotation
        if (!this.rotating && this.config.mode === "table") {
            this.rotating = true;
            if (this.config.auto_rotate && this.config.updateInterval) {
                setInterval(function() {
                    // Get next period
                    self.config.period = ((self.config.period === "recent") ? "ytd" : ((self.config.period === "ytd") ? "all" : "recent"));
                    self.updateDom(self.config.animationSpeed);
                }, this.config.updateInterval);
            }
        }
    },
    /**
     * @function log
     * @description logs the message, prefixed by the Module name, if debug is enabled.
     * @param  {string} msg            the message to be logged
     */
    log: function(msg) {
        if (this.config && this.config.debug) {
            Log.info(`${this.name}: ` + JSON.stringify(msg));
        }
    },
    /**
     * @function addFilters
     * @description adds filters to the Nunjucks environment.
     */
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
        var duration = moment.duration(timeInSeconds, "seconds");
        return Math.floor(duration.asHours()) + "h " + duration.minutes() + "m";
    },
    // formatDistance
    formatDistance: function(value, digits, showUnits) {
        const distanceMultiplier = this.config.units === "imperial" ? 0.0006213712 : 0.001;
        const distanceUnits = this.config.units === "imperial" ? " mi" : " km";
        return this.formatNumber(value, distanceMultiplier, digits, (showUnits ? distanceUnits : null));
    },
    // formatElevation
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
    /**
     * @function roundValue
     * @description rounds the value to number of digits.
     * @param  {decimal} value            the value to be rounded
     * @param  {integer} digits           the number of digits to round the value to
     */
    roundValue: function(value, digits) {
      var rounder = Math.pow(10, digits);
      return (Math.round(value * rounder) / rounder).toFixed(digits);
    },


    /**
     * @function addMeasure
     * @description adds measure offset to progress bar to show comparative progress.
     *
     */
    addMeasure: function() {
      var measure =  (moment().dayOfYear() / 365);
      var to = Math.round( 510 * (1 - measure));
      //this.log("New offset: "+to);
      return(Math.max(0, to));
    },

    /**
     * @function addMeasure
     * @description adds offset to progress bar to show actual progress.
     *
     */
    addOffset: function(distance) {
      //this.log("Correcting Offset!");
/*      const meters = document.querySelectorAll('svg[data-value] .meter');
      this.log(meters);
      meters.forEach( (path) => {
        // Get the length of the path
        let length = path.getTotalLength();
        // console.log(length) once and hardcode the stroke-dashoffset and stroke-dasharray in the SVG if possible
        // or uncomment to set it dynamically
        // path.style.strokeDashoffset = length;
        // path.style.strokeDasharray = length;

        // Get the value of the meter
        // let value = parseInt(path.parentNode.getAttribute('data-value'));
        let value = Math.round(distance/this.config.runningGoal);
        this.log("Data value: "+value);
        // Calculate the percentage of the total length
        let to = length * ((100 - value) / 100);
        this.log("New offset: "+to);
        // Trigger Layout in Safari hack https://jakearchibald.com/2013/animated-line-drawing-svg/
        path.getBoundingClientRect();
        // Set the Offset
        return(Math.max(0, to));
      });
*/
      var value = (distance / this.config.runningGoal);
      //this.log("Data value: " + value);
      // Calculate the percentage of the total length
      var to = Math.round( 510 * (1 - value));
      //this.log("New offset: "+to);
      // Set the Offset
      return(Math.max(0, to));
    }
});
