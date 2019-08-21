/**
 * @file node_helper.js
 *
 * @author ianperrin
 * @license MIT
 *
 * @see  http://github.com/ianperrin/MMM-Strava
 */

/**
 * @external node_helper
 * @see https://github.com/MichMich/MagicMirror/blob/master/modules/node_modules/node_helper/index.js
 */
const NodeHelper = require("node_helper");
/**
 * @external moment
 * @see https://www.npmjs.com/package/moment
 */
const moment = require("moment");
/**
 * @external strava-v3
 * @see https://www.npmjs.com/package/strava-v3
 */
const strava = require("./strava_api.js");

/**
 * @alias fs
 * @see {@link http://nodejs.org/api/fs.html File System}
 */
const fs = require("fs");
/**
 * @module node_helper
 * @description Backend for the module to query data from the API provider.
 *
 * @requires external:node_helper
 * @requires external:moment
 * @requires external:strava-v3
 * @requires alias:fs
 */
module.exports = NodeHelper.create({
    /**
     * @function start
     * @description Logs a start message to the console.
     * @override
     */
    start: function () {
        console.log("Starting module helper: " + this.name);
        this.createRoutes();
        this.readTokens();
    },
    // Set the minimum MagicMirror module version for this module.
    requiresVersion: "2.2.0",
    // Config store e.g. this.configs["identifier"])
    configs: Object.create(null),
    // Tokens file path
    tokensFile: `${__dirname}/tokens.json`,
    activitiesFile: `${__dirname}/cache/activities.json`,
    segmentsFile: `${__dirname}/cache/segments.json`,
    activityList: [],
    segmentList: [],

    // Token store e.g. this.tokens["client_id"])
    tokens: Object.create(null),
    /**
     * @function socketNotificationReceived
     * @description receives socket notifications from the module.
     * @override
     *
     * @param {string} notification - Notification name
     * @param {Object.<string, Object>} payload - Detailed payload of the notification (key: module identifier, value: config object).
     */
    socketNotificationReceived: function (notification, payload) {
        var self = this;
        this.log("Received notification: " + notification);
        if (notification === "GET_STRAVA_DATA") {
            // Validate module config
            if (payload.config.access_token || payload.config.strava_id) {
                this.log(`Legacy config in use for ${payload.identifier}`);
                this.sendSocketNotification("WARNING", { "identifier": payload.identifier, "data": { message: "Strava authorisation is changing. Please update your config." } });
            }
            // Initialise and store module config
            if (!(payload.identifier in this.configs)) {
                this.configs[payload.identifier] = {};
            }
            this.configs[payload.identifier].config = payload.config;
            // Check for token authorisations
            if (payload.config.client_id && (!(payload.config.client_id in this.tokens))) {
                this.log(`Unauthorised client id for ${payload.identifier}`);
                this.sendSocketNotification("ERROR", { "identifier": payload.identifier, "data": { message: `Client id unauthorised - please visit <a href="/${self.name}/auth/">/${self.name}/auth/</a>` } });
            }
            // Schedule API calls
            this.getData(payload.identifier);
            setInterval(function () {
                self.getData(payload.identifier);
            }, payload.config.reloadInterval);
        }
    },
    /**
     * @function createRoutes
     * @description Creates the routes for the authorisation flow.
     */
    createRoutes: function () {
        this.expressApp.get(`/${this.name}/auth/modules`, this.authModulesRoute.bind(this));
        this.expressApp.get(`/${this.name}/auth/request`, this.authRequestRoute.bind(this));
        this.expressApp.get(`/${this.name}/auth/exchange`, this.authExchangeRoute.bind(this));
    },
    /**
     * @function authModulesRoute
     * @description returns a list of module identifiers
     *
     * @param {object} req
     * @param {object} res - The HTTP response that an Express app sends when it gets an HTTP request.
     */
    authModulesRoute: function (req, res) {
        try {
            var identifiers = Object.keys(this.configs);
            identifiers.sort();
            var text = JSON.stringify(identifiers);
            res.contentType("application/json");
            res.send(text);
        } catch (error) {
            this.log(error);
            res.redirect(`/${this.name}/auth/?error=${JSON.stringify(error)}`);
        }
    },
    /**
     * @function authRequestRoute
     * @description redirects to the Strava Request Access Url
     *
     * @param {object} req
     * @param {object} res - The HTTP response the Express app sends when it gets an HTTP request.
     */
    authRequestRoute: function (req, res) {
        try {
            const moduleIdentifier = req.query.module_identifier;
            const clientId = this.configs[moduleIdentifier].config.client_id;
            const redirectUri = `http://${req.headers.host}/${this.name}/auth/exchange`;
            this.log(`Requesting access for ${clientId}`);
            const args = {
                "client_id": clientId,
                "redirect_uri": redirectUri,
                "approval_prompt": "force",
                "scope": "read,activity:read,activity:read_all",
                "state": moduleIdentifier
            };
            const url = strava.oauth.getRequestAccessURL(args);
            res.redirect(url);
        } catch (error) {
            this.log(error);
            res.redirect(`/${this.name}/auth/?error=${JSON.stringify(error)}`);
        }
    },
    /**
     * @function authExchangeRoute
     * @description exchanges code obtained from the access request and stores the access token
     *
     * @param {object} req
     * @param {object} res - The HTTP response that an Express app sends when it gets an HTTP request.
     */
    authExchangeRoute: function (req, res) {
        try {
            const authCode = req.query.code;
            const moduleIdentifier = req.query.state;
            const clientId = this.configs[moduleIdentifier].config.client_id;
            const clientSecret = this.configs[moduleIdentifier].config.client_secret;
            this.log(`Getting token for ${clientId}`);
            var self = this;
            const args = {
                client_id: clientId,
                client_secret: clientSecret
            };
            strava.oauth.exchangeToken(args, authCode, function (err, payload, limits) {
                if (err) {
                    console.error(err);
                    res.redirect(`/${self.name}/auth/?error=${err}`);
                    return;
                }
                // Store tokens
                self.saveToken(clientId, payload, (err, data) => {
                    // redirect route
                    res.redirect(`/${self.name}/auth/?status=success`);
                });
            });
        } catch (error) {
            this.log(error);
            res.redirect(`/${this.name}/auth/?error=${JSON.stringify(error)}`);
        }
    },
    /**
     * @function refreshTokens
     * @description refresh the authenitcation tokens from the API and store
     *
     * @param {string} moduleIdentifier - The module identifier.
     */
    refreshTokens: function (moduleIdentifier) {
        this.log(`Refreshing tokens for ${moduleIdentifier}`);
        var self = this;
        const args = {
            client_id: this.configs[moduleIdentifier].config.client_id,
            client_secret: this.configs[moduleIdentifier].config.client_secret
        };
        const token = this.tokens[args.client_id].token;
        strava.oauth.refreshTokens(args, token.refresh_token, function (err, payload, limits) {
            var data = self.handleApiResponse(moduleIdentifier, err, payload, limits);
            if (data && (token.access_token != data.access_token || token.refresh_token != data.refresh_token)) {
                token.token_type = data.token_type || token.token_type;
                token.access_token = data.access_token || token.access_token;
                token.refresh_token = data.refresh_token || token.refresh_token;
                token.expires_at = data.expires_at || token.expires_at;
                // Store tokens
                self.saveToken(args.client_id, token, (err, data) => {
                    if (!err) {
                        //self.getData(moduleIdentifier);
                    }
                });
            } else {
                throw new Error(`Failed to refresh tokens for ${moduleIdentifier}. Check config or module authorisation.`);
            }
            return;
        });
    },

    /**
     * @function getData
     * @description gets data from the Strava API based on module mode
     *
     * @param {string} moduleIdentifier - The module identifier.
     */
    getData: function (moduleIdentifier) {
        this.log(`Getting data for ${moduleIdentifier}`);
        const moduleConfig = this.configs[moduleIdentifier].config;
        try {
            // Get access token
            const accessToken = moduleConfig.access_token || this.tokens[moduleConfig.client_id].token.access_token;
            if (moduleConfig.mode === "table") {
                try {
                    // Get athelete Id
                    const athleteId = moduleConfig.strava_id || this.tokens[moduleConfig.client_id].token.athlete.id;
                    // Call api
                    this.getAthleteStats(moduleIdentifier, accessToken, athleteId);
                } catch (error) {
                    this.log(`Athete id not found for ${moduleIdentifier}`);
                }
            } else if (moduleConfig.mode === "chart") {
                // Get initial date
                moment.locale(moduleConfig.locale);
                var after = moment().startOf(moduleConfig.period === "ytd" ? "year" : "week").unix();
                // Call api
                this.getAthleteActivities(moduleIdentifier, accessToken, 1);
            }
        } catch (error) {
            this.log(`Access token not found for ${moduleIdentifier}`);
        }
    },

    /**
     * @function getAthleteStats
     * @description get stats for an athlete from the API
     *
     * @param {string} moduleIdentifier - The module identifier.
     * @param {string} accessToken
     * @param {integer} athleteId
     */
    getAthleteStats: function (moduleIdentifier, accessToken, athleteId) {
        this.log("Getting athlete stats for " + moduleIdentifier + " using " + athleteId);
        var self = this;
        strava.athletes.stats({ "access_token": accessToken, "id": athleteId }, function (err, payload, limits) {
            var data = self.handleApiResponse(moduleIdentifier, err, payload, limits);
            if (data) {
                self.sendSocketNotification("DATA", { "identifier": moduleIdentifier, "data": data });
            }
        });
    },

    /**
     * @function getAthleteActivities
     * @description get logged in athletes activities from the API
     *
     * @param {string} moduleIdentifier - The module identifier.
     * @param {string} accessToken
     * @param {string} after
     */
    getAthleteActivities: function (moduleIdentifier, accessToken, page) {
        this.log("Getting athlete activities for " + moduleIdentifier);
        var self = this;

        var activityIDs = [];
        if (page == "1") {
            if (!fs.existsSync(this.activitiesFile)) {
              self.log("Activities file not found! Will create a new one.");
              activityIDs = [];
              this.activityList = [];
            } else {
                try {
                    const activityData = fs.readFileSync(this.activitiesFile, "utf8");
                    this.activityList = JSON.parse(activityData);
                    for (var i = 1; i < Object.keys(this.activityList).length; i++) {
                      activityIDs.push(this.activityList[i].id);
                    }
                    self.log("Successfully loaded " + this.activityList.length + " activities from file!");
                    self.log("ActivityIDs: "+JSON.stringify(activityIDs));
                } catch (fe) {
                    console.log("An error occured while trying to load cached activities: "+fe);
                    activityIDs = [];
                    this.activityList = [];
                }
            }
        }
        //console.log(moment(this.activityList[0].start_date_local).format("X"));
        var after = (this.activityList[0].start_date_local) ? (moment(this.activityList[0].start_date_local).add(1, "minutes").format("X")) : "946684800";
        console.log("Fetching activities after "+moment.unix(after).format("YYYY-MM-DD")+", Page "+page);
        //console.log(after, page);

        strava.athlete.listActivities({ "access_token": accessToken, "after": after, "per_page": 200, "page": page }, function (err, payload, limits) {
            var activities = self.handleApiResponse(moduleIdentifier, err, payload, limits);
            if (activities) {
                console.log(activities.length + " Activities found");
                self.activityList = /*activities.concat(self.activityList)*/self.activityList.concat(activities);
                self.activityList.sort(function (a, b) { return moment(b.start_date).clone().format("x") - moment(a.start_date).clone().format("x");});
                /*for (i=0; i < self.activityList.length; i++) {
                  console.log(self.activityList[i].start_date);
                }*/
                if (activities.length == 200) {
                  console.log("More to come...");
                  page++;
                  self.getAthleteActivities(moduleIdentifier, accessToken, page);
                } else {
                  console.log("Fetched " + self.activityList.length + " Activities!");
                  fs.writeFile(self.activitiesFile, JSON.stringify(self.activityList), (err) => {
                    if (err) throw err;
                    console.log("Activities file has been saved!");
                  });
                  self.getSegments(moduleIdentifier, accessToken);
                }

                //old module
                /*var data = {
                    "identifier": moduleIdentifier,
                    "data": self.summariseActivities(moduleIdentifier, activityList),
                };
                self.sendSocketNotification("DATA", data);*/

            }
        });
    },


    getSegments: function (moduleIdentifier, accessToken) {
        this.log("Getting completed Segments for" + moduleIdentifier);
        var self = this;
        var moduleConfig = this.configs[moduleIdentifier].config;

        // fill Segment List
        var segIDs = [];
        var segList = [];
        var apiCalls = [];
        if (!fs.existsSync(this.segmentsFile)) {
            console.log("Segments file not found! Will create a new one.");
            segList = [];
        } else {
            try {
                const segmentData = fs.readFileSync(this.segmentsFile, "utf8");
                segList = JSON.parse(segmentData);
                for (var i = 1; i < Object.keys(segList).length; i++) {
                  segIDs.push(segList[i].id);
                }
                console.log("Successfully loaded Segment List!");
                //console.log("SegList: "+JSON.stringify(segList));
                console.log("SegIDs: "+JSON.stringify(segIDs));
            } catch (error) {
                segList = [];
            }
        }

        console.log(this.activityList.length);
        for (var i = 0; i < 10/*this.activityList.length*/; i++) {
          if (!this.activityList[i].segmentsChecked) {
          apiCalls.push(new Promise((resolve, reject) => {
            strava.activities.get({ "access_token": accessToken, id: self.activityList[i].id, "include_all_efforts": true }, function (err, payload, limits) {
            /*
            output:
            {
               shortTermUsage: 3,
               shortTermLimit: 600,
               longTermUsage: 12,
               longTermLimit: 30000
            }
            */
              if (err) {
                reject("Error!" +err);
              } else if (limits.shortTermUsage >= 600 ||  limits.longTermUsage >= 30000) {
                  console.log("API LIMIT EXCEEDED");
              } else {
                console.log("Checking Activity: " + self.activityList[i].id);
                var activity = self.handleApiResponse(moduleIdentifier, err, payload, limits);
                if ((activity) && (activity.segment_efforts.length)) {
                  console.log(activity.segment_efforts.length + " Segments found!");
                  for (var j = 0; j < activity.segment_efforts.length; j++) {
                    var currentID = activity.segment_efforts[j].segment.id;
                    if (!segIDs.includes(currentID)) {
                      segIDs.push(currentID);
                      segList.push(
                          {
                          "id": currentID,
                          "type": activity.segment_efforts[j].segment.activity_type,
                          "name": activity.segment_efforts[j].segment.name,
                          "time": activity.segment_efforts[j].elapsed_time,
                          "distance": activity.segment_efforts[j].distance,
                          "city": activity.segment_efforts[j].segment.city
                          }
                      );
                    }
                  }
                } else {
                  console.log("Activity "+self.activityList[i].id+": No segments found!");
                }
                self.activityList[i].segmentsChecked = true;
                resolve(/*segList*/);
              }
            });
          }));
        }}

        Promise.all(apiCalls)
        .then( function () {
            console.log("SegList: "+JSON.stringify(segList));
            //self.getCrowns(moduleIdentifier, accessToken, segIDs, segList);
        })
        .catch( error => console.log("Something went wrong: " +error ));
    },

    getCrowns: function (moduleIdentifier, accessToken, segIDs, segList) {
        let rankings = {
            "Run": [0,0,0,0,0,0,0,0,0,0],
            "Ride": [0,0,0,0,0,0,0,0,0,0]
        };
        var self = this;
        Promise.all(segIDs.map(id =>
          new Promise((resolve, reject) => {
            strava.segments.listLeaderboard({ "access_token": accessToken, id: id, "page": 1, "context_entries": 1, "per_page": 1}, function (err, payload, limits) {
              if (err) {
                reject("Error!" +err);
              } else {
                var rank;
                var segmentLeaderboard = self.handleApiResponse(moduleIdentifier, err, payload, limits);
                //console.log("Leaderboard : "+JSON.stringify(segmentLeaderboard));
                if (segmentLeaderboard) {
                    segmentLeaderboard.entries.forEach(entry => {
                      if (entry.athlete_name == "Dirk K.") {
                        rank = entry.rank;
                        segList.find(index => index.id == id).rank = rank;
                      }
                    });
                    if (rank < 11) {
                        if (segList.find(index => index.id == id).type == "Run") {
                            rankings.Run[rank-1] = rankings.Run[rank-1] + 1;
                        } else {
                            rankings.Ride[rank-1] = rankings.Ride[rank-1] + 1;
                        }
                    }
                }
                resolve();
              }
            });
          })
        )).then( function () {
            if (segList[0].id) { segList.unshift(moment()); }
            console.log("SegList: "+JSON.stringify(segList));
            console.log("Rankings: "+JSON.stringify(rankings));
            fs.writeFile(self.segmentsFile, JSON.stringify(segList), (err) => {
                if (err) throw err;
                console.log("Segments file has been saved!");
            });
            //this.sendSocketNotification("CROWNS", rankings);
        }).catch(error => console.log("Something went wrong: " +error));
    },

    /**
     * @function handleApiResponse
     * @description handles the response from the API to catch errors and faults.
     *
     * @param {string} moduleIdentifier - The module identifier.
     * @param {Object} err
     * @param {Object} payload
     * @param {Object} limits
     */
    handleApiResponse: function (moduleIdentifier, err, payload, limits) {
        // Strava-v3 package errors
        if (err) {
            this.log({ module: moduleIdentifier, error: err });
            this.sendSocketNotification("ERROR", { "identifier": moduleIdentifier, "data": { "message": err.msg } });
            return false;
        }
        // Strava API "fault"
        if (payload && payload.hasOwnProperty("message") && payload.hasOwnProperty("errors")) {
            if (payload.errors[0].field === "access_token" && payload.errors[0].code === "invalid") {
                this.refreshTokens(moduleIdentifier);
            } else {
                this.log({ module: moduleIdentifier, errors: payload.errors });
                this.sendSocketNotification("ERROR", { "identifier": moduleIdentifier, "data": payload });
            }
            return false;
        }
        // Strava Data
        if (payload) {
            return payload;
        }
        // Unknown response
        this.log(`Unable to handle API response for ${moduleIdentifier}`);
        return false;
    },
    /**
     * @function summariseActivities
     * @description summarises a list of activities for display in the chart.
     *
     * @param {string} moduleIdentifier - The module identifier.
     */
    summariseActivities: function (moduleIdentifier, activityList) {
        this.log("Summarising athlete activities for " + moduleIdentifier);
        var moduleConfig = this.configs[moduleIdentifier].config;
        var activitySummary = Object.create(null);
        var activityName;
        // Initialise activity summary
        var periodIntervals = moduleConfig.period === "ytd" ? moment.monthsShort() : moment.weekdaysShort();
        for (var activity in moduleConfig.activities) {
            if (moduleConfig.activities.hasOwnProperty(activity)) {
                activityName = moduleConfig.activities[activity].toLowerCase();
                activitySummary[activityName] = {
                    total_distance: 0,
                    total_elevation_gain: 0,
                    total_moving_time: 0,
                    max_interval_distance: 0,
                    intervals: Array(periodIntervals.length).fill(0)
                };
            }
        }
        // Summarise activity totals and interval totals
        for (var i = 0; i < Object.keys(activityList).length; i++) {
            // Merge virtual activities
            activityName = activityList[i].type.toLowerCase().replace("virtual");
            var activityTypeSummary = activitySummary[activityName];
            // Update activity summaries
            if (activityTypeSummary) {
                var distance = activityList[i].distance;
                activityTypeSummary.total_distance += distance;
                activityTypeSummary.total_elevation_gain += activityList[i].total_elevation_gain;
                activityTypeSummary.total_moving_time += activityList[i].moving_time;
                const activityDate = moment(activityList[i].start_date_local);
                const intervalIndex = moduleConfig.period === "ytd" ? activityDate.month() : activityDate.weekday();
                activityTypeSummary.intervals[intervalIndex] += distance;
                // Update max interval distance
                if (activityTypeSummary.intervals[intervalIndex] > activityTypeSummary.max_interval_distance) {
                    activityTypeSummary.max_interval_distance = activityTypeSummary.intervals[intervalIndex];
                }
            }
        }
        this.log("Summary: "+JSON.stringify(activitySummary));
        return activitySummary;
    },
    /**
     * @function saveToken
     * @description save token for specified client id to file
     *
     * @param {integer} clientId - The application's ID, obtained during registration.
     * @param {object} token - The token response.
     */
    saveToken: function (clientId, token, cb) {
        var self = this;
        this.readTokens();
        // No token for clientId - delete existing
        if (clientId in this.tokens && !token) {
            delete this.tokens[clientId];
        }
        // No clientId in tokens - create stub
        if (!(clientId in this.tokens) && token) {
            this.tokens[clientId] = {};
        }
        // Add token for client
        if (token) {
            this.tokens[clientId].token = token;
        }
        // Save tokens to file
        var json = JSON.stringify(this.tokens, null, 2);
        fs.writeFile(this.tokensFile, json, "utf8", function (error) {
            if (error && cb) { cb(error); }
            if (cb) { cb(null, self.tokens); }
        });
    },
    /**
     * @function readTokens
     * @description reads the current tokens file
     */
    readTokens: function () {
        if (this.tokensFile) {
            try {
                const tokensData = fs.readFileSync(this.tokensFile, "utf8");
                this.tokens = JSON.parse(tokensData);
            } catch (error) {
                this.tokens = {};
            }
            return this.tokens;
        }
    },
    /**
     * @function log
     * @description logs the message, prefixed by the Module name, if debug is enabled.
     * @param  {string} msg            the message to be logged
     */
    log: function (msg) {
//        if (this.config && this.config.debug) {
          console.log(this.name + ":", JSON.stringify(msg));
//        }
    }
});
