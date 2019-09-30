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
    config : Object.create(null),
    // Tokens file path
    tokensFile: `${__dirname}/tokens.json`,
    activitiesFile: `${__dirname}/cache/activities.json`,
    segmentsFile: `${__dirname}/cache/segments.json`,
    recordsFile: `${__dirname}/cache/records.json`,
    activityList: [],
    segmentList: [],
    crownCounter: 0,
    actCounter: 0,
    apiCounter: 0,

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
            if (payload.access_token || payload.strava_id) {
                this.log(`Legacy config in use`);
                this.sendSocketNotification("WARNING", {"data": { message: "Strava authorisation is changing. Please update your config." } });
            }
            this.config = payload;
            // Check for token authorisations
            if (payload.client_id && (!(payload.client_id in this.tokens))) {
                this.log(`Unauthorised client id`);
                this.sendSocketNotification("ERROR", { "data": { message: `Client id unauthorised - please visit <a href="/${self.name}/auth/">/${self.name}/auth/</a>` } });
            }
            // Schedule API calls
            this.getData();
            setInterval(function () {
                self.getData();
            }, payload.fetchInterval);
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
            var identifier = this.config;
            var text = JSON.stringify(identifier);
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
            const clientId = this.config.client_id;
            const redirectUri = `http://${req.headers.host}/${this.name}/auth/exchange`;
            this.log(`Requesting access for ${clientId}`);
            const args = {
                "client_id": clientId,
                "redirect_uri": redirectUri,
                "approval_prompt": "force",
                "scope": "read,activity:read,activity:read_all",
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
            const clientId = this.config.client_id;
            const clientSecret = this.config.client_secret;
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
     */
    refreshTokens: function () {
        this.log(`Refreshing tokens`);
        var self = this;
        const args = {
            client_id: this.config.client_id,
            client_secret: this.config.client_secret
        };
        const token = this.tokens[args.client_id].token;
        strava.oauth.refreshTokens(args, token.refresh_token, function (err, payload, limits) {
            var data = self.handleApiResponse(err, payload, limits);
            if (data && (token.access_token != data.access_token || token.refresh_token != data.refresh_token)) {
                token.token_type = data.token_type || token.token_type;
                token.access_token = data.access_token || token.access_token;
                token.refresh_token = data.refresh_token || token.refresh_token;
                token.expires_at = data.expires_at || token.expires_at;
                // Store tokens
                self.saveToken(args.client_id, token, (err, data) => {
                    if (!err) {
                        //self.getData();
                    }
                });
            } else {
                throw new Error(`Failed to refresh tokens. Check config or module authorisation.`);
            }
            return;
        });
    },

    /**
     * @function getData
     * @description gets data from the Strava API based on module mode
     *
     */
    getData: function () {
        this.log(`Getting data at ` + moment().format("DD/MM HH:mm"));
        this.apiCounter = 0;
        const moduleConfig = this.config;

        try {
            // Get access token
            const accessToken = moduleConfig.access_token || this.tokens[moduleConfig.client_id].token.access_token;

                try {
                    // Get athlete Id
                    const athleteId = moduleConfig.strava_id || this.tokens[moduleConfig.client_id].token.athlete.id;
                    // Call api
                    this.getAthleteStats(accessToken, athleteId);

                    moment.locale(moduleConfig.locale);

                    // Call api
                    this.getAthleteActivities(accessToken, 1);

                } catch (error) {
                    this.log(`Athlete id not found!`);
                }
        } catch (error) {
            this.log(`Error in fetching data`);
        }
    },


    getAthleteStats: function (accessToken, athleteId) {
        this.log("Getting athlete stats for using " + athleteId);
        var moduleConfig = this.config;
        var statsData = new Object({});
        var self = this;
        strava.athletes.stats({ "access_token": accessToken, "id": athleteId }, function (err, payload, limits) {
            if (err) {
                self.log("Error!" +err);
            } else if (limits.shortTermUsage >= 600 ||  limits.longTermUsage >= 30000) {
                self.log("API LIMIT EXCEEDED");
                self.sendSocketNotification("STATS", {});
            } else {
                statsData = self.handleApiResponse(err, payload, limits);
                //self.log("Stats: "+JSON.stringify(statsData));
                if (statsData) {
                    for (var value in statsData) {
                        if (JSON.stringify(value).includes("totals")) {
                          if (statsData[value].distance && statsData[value].distance > 0) {
                            if (JSON.stringify(value).includes("run")) {
                              distance = (moduleConfig.units == "metric") ? (statsData[value].distance / 1000) : (statsData[value].distance / 1609.34);
                              //moment.js "hack" to convert pace into m:ss. The number of seconds is added to start of the day (0:00) and the new "time is converted"
                              statsData[value].pace = moment().startOf("day").seconds(Math.round(statsData[value].moving_time / distance)).format("m:ss");
                            } else if (JSON.stringify(value).includes("ride")) {
                              distance = (moduleConfig.units == "metric") ? (statsData[value].distance) : (statsData[value].distance / 1.60934);
                              statsData[value].pace = (distance / statsData[value].moving_time * 3.6).toFixed(2);
                            } else {
                              distance = (moduleConfig.units == "metric") ? (statsData[value].distance / 100) : (statsData[value].distance / 100 * 0.9144);
                              statsData[value].pace = moment().startOf("day").seconds(Math.round(statsData[value].moving_time / distance)).format("m:ss");
                            }
                          } else {
                            statsData[value].pace = 0;
                          }
                       }
                    }
                    self.sendSocketNotification("STATS", statsData);
                }
            }
            self.apiCounter++;
        });
    },

    /**
     * @function getAthleteActivities
     * @description get logged in athletes activities from the API
     *
     */
    getAthleteActivities: function (accessToken, page) {
        var self = this;
        var after = "946684800";
        var activityIDs = [];

        /*
        *  Load activities from file if it already exists
        */
        if (page == "1") {
            self.log("Trying to load athlete activities from file");
            if (!fs.existsSync(this.activitiesFile)) {
                self.log("Activities file not found! Will create a new one.");
                this.activityList = [];
            } else {
                const activityData = fs.readFileSync(this.activitiesFile, "utf8");
                this.activityList = JSON.parse(activityData);
                for (var i = 1; i < Object.keys(this.activityList).length; i++) {
                    activityIDs.push(this.activityList[i].id);
                }
                self.log("Successfully loaded " + this.activityList.length + " activities from file!");
                after = (moment(this.activityList[this.activityList.length - 1].start_date_local).add(1, "minutes").format("X")) || "946684800";
            }
        }

        this.log("Fetching athlete activities after "+moment.unix(after).clone().format("YYYY-MM-DD")+", page "+page);
        strava.athlete.listActivities({ "access_token": accessToken, "after": after, "per_page": 200, "page": page }, function (err, payload, limits) {
            if (err) {
                self.log("Error!" +err);
            } else if ((limits) && (limits.shortTermUsage >= 600 ||  limits.longTermUsage >= 30000)) {
                self.log("API LIMIT EXCEEDED");
                self.sendSocketNotification("ACTIVITIES", self.activityList);
                self.getSegments(accessToken);
            } else {
                var activities = self.handleApiResponse(err, payload, limits);
                if (activities) {
                    console.log(activities.length + " Activities found");
                    self.activityList = self.activityList.concat(activities);
                    //self.activityList.sort(function (a, b) { return moment(a.start_date).clone().format("x") - moment(b.start_date).clone().format("x");});
                    if (activities.length == 200) {
                        self.log("More to come...");
                        page = page + 1;
                        self.getAthleteActivities(accessToken, page);
                    } else {
                        console.log("Fetched " + self.activityList.length + " Activities!");
                        for (i = 0; (i < self.activityList.length); i++) {
                            delete self.activityList[i].map;
                        }
                        self.sendSocketNotification("ACTIVITIES", self.activityList);
                        self.getSegments(accessToken);
                    }
                //old module
                /*var data = {
                    "identifier": moduleIdentifier,
                    "data": self.summariseActivities(moduleIdentifier, activityList),
                };*/
              } else {
                self.sendSocketNotification("ACTIVITIES", self.activityList);
                self.getSegments(accessToken);
              }
            }
            self.apiCounter++;
        });
    },


    getSegments: function (accessToken) {
        this.log("Getting Activity Details");
        var self = this;
        var moduleConfig = this.config;

        // fill Segment List
        var segIDs = [];
        var recIDs = [];
        var apiCalls = [];
        if (!fs.existsSync(this.segmentsFile)) {
            console.log("Segments file not found! Will create a new one.");
            self.segmentList = [];
        } else {
            //try {
                var segmentData = fs.readFileSync(this.segmentsFile, "utf8");
                self.segmentList = JSON.parse(segmentData);
                for (var i = 0; i < Object.keys(self.segmentList).length; i++) {
                  segIDs.push(self.segmentList[i].id);
                }
                self.log("Successfully loaded Segment List!");
                //console.log("SegmentList: "+JSON.stringify(self.segmentList));
                //self.log("SegIDs: "+JSON.stringify(segIDs));
            /*} catch (error) {
                console.log("An error occured while trying to load cached segments: "+error);
                self.segmentList = [];
            }*/
        }

        if (!fs.existsSync(this.recordsFile)) {
            console.log("Error! Records file not found. Please perform a git pull.");
        } else {
            var records = fs.readFileSync(this.recordsFile, "utf8");
            self.records = JSON.parse(records);
            self.log("Successfully loaded records!");
            //self.log("Records: "+JSON.stringify(self.records));
        }

        for (var i = 0; (i < this.activityList.length); i++) {
          if (!this.activityList[i].segmentsChecked) {
            console.log("Activity not checked yet!");
            apiCalls.push(new Promise((resolve, reject) => {
              strava.activities.get({ "access_token": accessToken, id: self.activityList[i].id, "include_all_efforts": true }, function (err, payload, limits) {
                if (err) {
                  resolve("Error!");
                } else if ((limits) && (limits.shortTermUsage >= 600 ||  limits.longTermUsage >= 30000)) {
                    self.log("API LIMIT EXCEEDED while fetching activity details");
                    resolve("API_LIMIT");
                } else {
                  //console.log("Checking Activity: " + id);
                  var activity = self.handleApiResponse(err, payload, limits);

                  if (activity && activity.segment_efforts.length && !activity.private) {
                    //self.log("Activity "+activity.id+": "+activity.segment_efforts.length + " Segments found!");
                    for (var j = 0; j < activity.segment_efforts.length; j++) {
                      var currentID = activity.segment_efforts[j].segment.id;
                      if (!segIDs.includes(currentID)) {
                        segIDs.push(currentID);
                        //console.log("Pushed Segment: "+currentID)
                        self.segmentList.push(
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
                    self.log("Activity "+activity.id+": No segments found!");
                  }


                  // record best efforts of the activity
                  if (activity.best_efforts) {
                    for (var k = 0; k < activity.best_efforts.length; k++) {
                      //console.log(JSON.stringify(activity.best_efforts[k]));
                      if (activity.best_efforts[k].hasOwnProperty("distance")) {
                        effort = activity.best_efforts[k].distance;
                      }
                      if (activity.type == "Run" && self.records.Run.hasOwnProperty(effort)) {
                        self.records.Run[effort].push(
                          {
                            "time": activity.best_efforts[k].elapsed_time,
                            "activity": activity.id,
                            "date": moment(activity.best_efforts[k].start_date_local).format("YYYY-MM-DD")
                          });
                        self.records.Run[effort].sort(function(a, b) { return (a.time - b.time); } );
                      } else if (activity.type == "Ride") {
                        self.records.Ride.max_speed.push(
                          {
                            "max_speed": activity.max_speed * 3.6,
                            "activity": activity.id,
                            "date": moment(activity.start_date_local).format("YYYY-MM-DD")
                          }
                        );
                        self.records.Ride.max_speed.sort(function(a, b) { return (a.max_speed - b.max_speed); } );
                        self.records.Ride.distance.push(
                          {
                            "distance": activity.distance,
                            "activity": activity.id,
                            "date": moment(activity.start_date_local).format("YYYY-MM-DD")
                          }
                        );
                        self.records.Ride.distance.sort(function(a, b) { return (a.distance - b.distance); } );
                      }
                    }
                  }

                  var actIndex = self.activityList.findIndex(element => { return element.id == activity.id; });
                  self.log("ActIndex: "+actIndex);
                  if (actIndex > -1) {self.activityList[actIndex].segmentsChecked = true; }
                  resolve(activity.id);
                }
              });
              self.apiCounter++;
            }));
          }
        }


        Promise.all(apiCalls)
        .then( function () {
            self.log(self.segmentList.length + " Segments");
            //self.log(JSON.stringify(self.records));
            if (self.activityList && self.activityList.length) {
              fs.writeFile(self.activitiesFile, JSON.stringify(self.activityList), (err) => {
                  if (err) throw err;
                  self.log("Activities file has been saved!");
              });
            }
            if (self.records && self.records.length != 0) {
              fs.writeFile(self.recordsFile, JSON.stringify(self.records), (err) => {
                  if (err) throw err;
                  self.log("Records file has been saved!");
              });
            }

            //self.sendSocketNotification("SEGMENTS", this.segmentList);
            self.sendSocketNotification("RECORDS", self.records);
            self.getCrowns(accessToken, segIDs);
        })
        .catch( error => console.log("Something went wrong while searching activities for segments: " +error ));
    },


    getCrowns: function (accessToken, segIDs) {
        var crownCalls = [];
        let rankings = {
            "Run": [0,0,0,0],            //ranks 1,2,3 and 4-10
            "Ride": [0,0,0,0]
        };
        var self = this;
        var cc = (this.crownCounter * 100 < this.segmentList.length) ? this.crownCounter : 0;
        for (var s = 100*cc; ((s < (100*(cc + 1))) && (s < this.segmentList.length)); s++) {
          if (this.segmentList[s].id) {
          crownCalls.push(new Promise((resolve, reject) => {
            strava.segments.listLeaderboard({ "access_token": accessToken, id: self.segmentList[s].id, "context_entries": 0, "per_page": 1}, function (err, payload, limits) {
              if (err) {
                resolve("Error!" +err);
              } else if ((limits) && (limits.shortTermUsage >= 600 ||  limits.longTermUsage >= 30000)) {
                self.log("API LIMIT EXCEEDED");
                resolve("API_LIMIT");
              } else {
                var entry = {};
                var segmentLeaderboard = self.handleApiResponse(err, payload, limits);
                if (segmentLeaderboard) {
                    //self.log("Leaderboard: "+JSON.stringify(segmentLeaderboard));
                    if (segmentLeaderboard.entries.length == 2) {
                      entry.rank = segmentLeaderboard.entries[1].rank;
                      entry.time = segmentLeaderboard.entries[1].elapsed_time;
                      entry.diff = (segmentLeaderboard.entries[0].elapsed_time - entry.time);
                      entry.date = segmentLeaderboard.entries[1].start_date_local;
                    } else {
                      entry.rank = segmentLeaderboard.entries[0].rank;
                      entry.time = segmentLeaderboard.entries[0].elapsed_time;
                      entry.date = segmentLeaderboard.entries[0].start_date_local;
                    }
                    entry.efforts = segmentLeaderboard.effort_count;
                }
                resolve(entry);
              }
            });
            self.apiCounter++;
          }));
          }
        }


        Promise.all(crownCalls)
        .then(entries => {
            self.log("CrownCounter: "+cc);
            for (var e = 0; (e < entries.length); e++) {
              var se = self.segmentList[(e + 100*cc)];
              if ((se) && (typeof entries[e] == "object")) {
                if (se.hasOwnProperty("entry") && (se.entry.rank != entries[e].rank)) {
                  entries[e].prevRank = se.entry.rank;
                  entries[e].date = moment();
                  self.log("Entry Rank has changed!"+entries[e]);
                }
                self.segmentList[(e+100*cc)].entry = entries[e];
                //self.log("Entry saved in segment");
              }
            }
            //self.log("Entries: "+JSON.stringify(entries));
            //self.log("SegmentList: "+JSON.stringify(self.segmentList));
            self.crownCounter = cc + 1;

            var rank = 0;
            for (var c = 0; c < self.segmentList.length; c++) {
              if (self.segmentList[c].entry && self.segmentList[c].entry.hasOwnProperty("rank")) {
                rank = self.segmentList[c].entry.rank;
                if (rank < 11) {
                  if (self.segmentList[c].type == "Run") {
                    if (rank > 3) {
                      rankings.Run[3]++;
                    } else {
                      rankings.Run[rank-1]++;
                    }
                  } else {
                    if (rank > 3) {
                      rankings.Ride[3]++;
                    } else {
                      rankings.Ride[rank-1]++;
                    }
                  }
                  self.log("Segment "+self.segmentList[c].id + ", Type: " + self.segmentList[c].type + ", Rank: "+rank);
                }
              }
            }
            self.log("Rankings: "+JSON.stringify(rankings));

            if (Array.isArray(self.segmentList) && self.segmentList.length) {
              fs.writeFile(self.segmentsFile, JSON.stringify(self.segmentList), (err) => {
                if (err) throw err;
                self.log("Segments file has been saved!");
              });
            }
            self.sendSocketNotification("CROWNS", rankings);
        }).catch(error => console.log("Something went wrong while fetching crowns: " +error));
    },



    /**
     * @function handleApiResponse
     * @description handles the response from the API to catch errors and faults.
     *
     * @param {Object} err
     * @param {Object} payload
     * @param {Object} limits
     */
    handleApiResponse: function (err, payload, limits) {
        // Strava-v3 package errors
        if (err) {
            this.log(err);
            this.sendSocketNotification("ERROR", err.msg);
            return false;
        }
        // Strava API "fault"
        if (payload && payload.hasOwnProperty("message") && payload.hasOwnProperty("errors")) {
            this.log("STRAVA API Error: "+JSON.stringify(payload));
            if (payload.errors[0] && payload.errors[0].field === "access_token" && payload.errors[0].code === "invalid") {
                this.refreshTokens();
            } else {
                this.log(payload.errors);
                //this.sendSocketNotification("ERROR", payload);
            }
            return false;
        }
        // Strava Data
        if (payload) {
            //if (limits) { this.log("API Call #"+limits.shortTermUsage+", "+limits.longTermUsage); }
            return payload;
        }
        // Unknown response
        this.log(`Unable to handle API response`);
        return false;
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
        if (this.config && this.config.debug) {
          console.log(this.name + ": ", (msg));
        }
    }
});
