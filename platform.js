exports.AugustPlatform = void 0;

const ModuleName = "homebridge-august-smart-locks"
const PlatformName = "AugustLocks"

class AugustPlatform {
    constructor(log, config, api) {
      this.log = log;
      this.platformLog = function (msg) { log("[August]", msg); };
  
      this.Accessory = api.platformAccessory;
      this.Service = api.hap.Service;
      this.Characteristic = api.hap.Characteristic;
      this.UUIDGen = api.hap.uuid;
  
      this.config = config || { "platform": PlatformName };
      this.email = this.config.email;
      this.phone = this.config.phone;
      this.password = this.config.password;
      this.securityToken = this.config.securityToken;;
      this.code = this.config.code;
      this.installId = this.config.installId;
      this.longPoll = parseInt(this.config.longPoll, 10) || 180;
      this.shortPoll = parseInt(this.config.shortPoll, 10) || 15;
      this.shortPollDuration = parseInt(this.config.shortPollDuration, 10) || 300;
      this.tout = null;
      this.updating = false;
      this.maxCount = this.shortPollDuration / this.shortPoll;
      this.count = this.maxCount;
      this.validData = false;
      this.hideLocks = (this.config.hideLocks) ? this.config.hideLocks.split(",") : [];
  
      this.augustApiConfig = {
        config: {
          apiKey: config.securityToken || "7cab4bbd-2693-4fc1-b99b-dec0fb20f9d4", //pulled from android apk july 2020,
          installID: config.installId,
          password: config.password,
          IDType: config.email ? 'email' : 'phone',
          augustID: config.email ? config.email : config.phone
        }
      }
      
      this.augustApi =  require('august-connect');
  
      this.manufacturer = "AUGUST";
      this.accessories = {};
  
      if (api) {
        this.api = api;
        this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
  
      }
  
      // Definition Mapping
      this.lockState = ["unlock", "lock"];
  
    }
  
    
  
    // Method to setup accessories from config.json
    didFinishLaunching() {
  
      if ((this.email || this.phone) && this.password) {
        // Add or update accessory in HomeKit
        this.addAccessory(this.periodicUpdate.bind(this));
  
      } else {
        this.platformLog("Please setup August login information!")
  
      }
  
    }
  
    // Method to add or update HomeKit accessories
    addAccessory(callback) {
      var self = this;
  
      self.login(function (error) {
        if (!error) {
          for (var deviceID in self.accessories) {
            var accessory = self.accessories[deviceID];
            if (!accessory.reachable) {
              // Remove extra accessories in cache
              self.removeAccessory(accessory);
  
            } else {
              // Update inital state
              self.updatelockStates(accessory);
  
            }
  
          }

        }
        callback();
  
      });
    }
  
    // Method to remove accessories from HomeKit
    removeAccessory(accessory) {
  
      if (accessory) {
        var deviceID = accessory.context.deviceID;
        accessory.context.log("Removed from HomeBridge.");
        self.api.unregisterPlatformAccessories(ModuleName, PlatformName, [accessory]);
        delete self.accessories[deviceID];
  
      }
    }
  
    // Method to restore accessories from cache
    configureAccessory(accessory) {
      var self = this;
      var accessoryID = accessory.context.deviceID;
  
      accessory.context.log = function (msg) { self.log("[" + accessory.displayName + "]", msg); };
      self.setService(accessory);
      self.accessories[accessoryID] = accessory;
  
    }
  
    // Method to setup listeners for different events
    setService(accessory) {
      var self = this;
      accessory
        .getService(self.Service.LockMechanism)
        .getCharacteristic(self.Characteristic.LockCurrentState)
        .on('get', self.getState.bind(self, accessory));
  
      accessory
        .getService(self.Service.LockMechanism)
        .getCharacteristic(self.Characteristic.LockTargetState)
        .on('get', self.getState.bind(self, accessory))
        .on('set', self.setState.bind(self, accessory));
  
      var service = accessory.getService(self.Service.ContactSensor);
      if (service) {
        service.getCharacteristic(self.Characteristic.ContactSensorState)
          .on('get', self.getDoorState.bind(self, accessory));
      }

    //   accessory
    //     .getService(this.Service.BatteryService)
    //     .getCharacteristic(this.Characteristic.BatteryLevel);
  
    //   accessory
    //     .getService(this.Service.BatteryService)
    //     .getCharacteristic(this.Characteristic.StatusLowBattery);
  
      accessory.on('identify', self.identify.bind(self, accessory));
  
    }
  
    // Method to setup HomeKit accessory information
    setAccessoryInfo(accessory) {
      var self = this;
      if (self.manufacturer) {
        accessory
          .getService(self.Service.AccessoryInformation)
          .setCharacteristic(self.Characteristic.Manufacturer, self.manufacturer);
  
      }
  
      if (accessory.context.serialNumber) {
        accessory
          .getService(self.Service.AccessoryInformation)
          .setCharacteristic(self.Characteristic.SerialNumber, accessory.context.serialNumber);
  
      }
  
      if (accessory.context.model) {
        accessory
          .getService(self.Service.AccessoryInformation)
          .setCharacteristic(self.Characteristic.Model, accessory.context.model);
  
      }
  
    }
  
    // Method to set target lock state
    setState(accessory, state, callback) {
      var self = this;
  
      // Always re-login for setting the state
      self.getDevice(function (getlocksError) {
        if (!getlocksError) {
          self.setState(accessory, state, function (setStateError) {
            callback(setStateError);
          });
  
        } else {
          callback(getlocksError);
  
        }
  
      }, accessory.context.deviceID);
  
    }
  
    // Method to get target lock state
    getState(accessory, callback) {
      // Get target state directly from cache
      callback(null, accessory.context.currentState);
  
    }

    // Method to get target door state
    getDoorState(accessory, callback) {
      // Get target state directly from cache
      callback(null, accessory.context.doorState);
    }

    // Method for state periodic update
    periodicUpdate() {
      var self = this;

      if (self.tout !== null) {
        self.log.debug("Update already scheduled")
        return;
      }

      // Determine polling interval
      if (self.count < self.maxCount) {
        self.count++;
        var refresh = self.shortPoll;
  
      } else {
        var refresh = self.longPoll;
        
      }
      // Setup periodic update with polling interval
      self.tout = setTimeout(function () {
        self.tout = null;
        self.updateState(function (error, skipped) {
          if (!error) {
            if (!skipped) {
              // Update states for all HomeKit accessories
              for (var deviceID in self.accessories) {
                var accessory = self.accessories[deviceID];
                self.updatelockStates(accessory);
  
              }
              self.periodicUpdate();

            }

          } else {
            // Re-login after short polling interval if error occurs
            self.count = self.maxCount - 1;
            self.periodicUpdate();
  
          }
  
        });
  
      }, refresh * 1000);
    }
  
    // Method to update lock state in HomeKit
    updatelockStates(accessory) {
      var self = this;
      accessory
        .getService(self.Service.LockMechanism)
        .setCharacteristic(self.Characteristic.LockCurrentState, accessory.context.currentState);
  
      accessory
        .getService(self.Service.LockMechanism)
        .getCharacteristic(self.Characteristic.LockTargetState)
        .getValue();
  
      accessory
        .getService(self.Service.ContactSensor)
        .setCharacteristic(self.Characteristic.ContactSensorState, accessory.context.doorState);

    //   accessory
    //     .getService(this.Service.BatteryService)
    //     .setCharacteristic(this.Characteristic.BatteryLevel, accessory.context.batt);
  
    //   accessory
    //     .getService(this.Service.BatteryService)
    //     .getCharacteristic(this.Characteristic.StatusLowBattery, accessory.context.low);
  
    }
  
    // Method to retrieve lock state from the server
    updateState(callback) {
      var self = this;
      if (self.updating) {
        //this.log("updateState called while previous still active");
        callback(null, true);
        return;
  
      }
  
      self.log.debug("updateState called");
      self.updating = true;
  
      if (this.validData) {
        // Refresh data directly from sever if current data is valid
        self.getlocks(false, function (error) {
          self.updating = false;
          callback(error, false);
  
        });
  
      } else {
        // Re-login if current data is not valid
       // this.login(function (error) {
          callback(new Error("Couldn't contact August API"), false);
  
       // });
  
      }
  
    }
  
    // Method to handle identify request
    identify(accessory, paired, callback) {
      accessory.context.log("Identify requested!");
      callback();
  
    }
  
    // login auth and get token
    login(callback) {
      var self = this;

      // Log in
      var authenticate = self.augustApi.authorize({
        config: self.augustApiConfig
      });
      authenticate.then(function (result) {
        self.postLogin(callback);
      }, function (error) {
        var authenticate = self.augustApi.authorize(self.code);
        authenticate.then(function (result) {
          self.postLogin(callback);
        }, function (error) {
          self.platformLog(error);
          self.platform("requesting a new 2FA code since the previous one did not work");
          self.augustApi.authorize().then(function () {
            callback(error, null);
          }, function () {
            callback(error, null);
          });
  
        });
      });
    }

    validateLogin() {
      // `locks` is being called because the `authorize` call without passing a `code` param
      // is very inconsistent with its error behavior, however, `locks` should always return if
      // authorization is successful
      // the promise will be rejected if not logged in
      return this.augustApi.locks();
    }
  
    postLogin(callback) {
      var self = this;
      self.getlocks(true, callback);
    }
  
    getlocks(start, callback) {
      var self = this;
  
      // get locks
      if(start) {
        self.platformLog("getting locks ...");
      };
      var getLocks = self.augustApi.locks();
      getLocks.then(function (json) {
        self.lockids = Object.keys(json);
        for (var i = 0; i < self.lockids.length; i++) {
          self.lock = json[self.lockids[i]];
          self.lockname = self.lock["LockName"];
          if(start) {
            self.platformLog(self.lock["HouseName"] + " " + self.lockname);
          }
          self.lockId = self.lockids[i];
          if(start) {
            self.platformLog("LockId " + " " + self.lockId);
          }
          
          if(!self.hideLocks.includes(self.lockId)){
            self.getDevice(callback, self.lockId, self.lockname, self.lock["HouseName"]);
          }
        }
  
      }, function (error) {
        self.platformLog(error);
        callback(error, null);
  
      });
  
    }
  
    getDevice(callback, lockId, lockName, houseName) {
      var self = this;
      
      self.validData = false;
  
      var getLock = self.augustApi.status({lockID: lockId});
      getLock.then(function (lock) {
        var locks = lock.info //JSON.parse(JSON.stringify(lock));
  
    //     self.platformLog(lock);
    //     self.platformLog(locks);
        if (!locks.bridgeID) {
          self.validData = true;
          return;
  
        }
        var thisDeviceID = locks.lockID.toString();
        var thisSerialNumber = locks.serialNumber.toString();
        var thisModel = locks.lockType.toString();
        var thislockName = lockName;
        var state = (lock.status == "kAugLockState_Locked") ? "locked" : (lock.status == "kAugLockState_Unlocked") ? "unlocked" : "error";
        var doorState = (lock.doorState == 'kAugDoorState_Closed') ? "closed" : (lock.doorState == 'kAugDoorState_Open') ? "open": "unknown";
        var isDoorOpened = doorState == "open" ? 1 : 0;
        var thishome = houseName;
        // battery no longer provided over api calls
        self.batt = 100;
  
        var isStateChanged = false;

        // if (self.batt < 20) {
        //   var lowbatt = self.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
        //   var newbatt = self.Characteristic.LockCurrentState.SECURED;
  
        // } else if (self.batt > 20) {
        //   var lowbatt = self.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        //   var newbatt = self.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
  
        // }
  
        // Initialization for opener
        if (!self.accessories[thisDeviceID]) {
          var uuid = self.UUIDGen.generate(thisDeviceID);
            var _Accessory = self.Accessory;
          // Setup accessory as GARAGE_lock_OPENER (4) category.
          var newAccessory = new _Accessory("August " + thislockName, uuid, 6);
  
          // New accessory found in the server is always reachable
          newAccessory.reachable = true;
  
          // Store and initialize variables into context
          newAccessory.context.deviceID = thisDeviceID;
          newAccessory.context.initialState = self.Characteristic.LockCurrentState.SECURED;
          newAccessory.context.currentState = self.Characteristic.LockCurrentState.SECURED;
          newAccessory.context.serialNumber = thisSerialNumber;
          newAccessory.context.home = thishome;
          newAccessory.context.model = thisModel;
        // newAccessory.context.batt = self.batt;
          newAccessory.context.low = self.low;
          newAccessory.context.doorState = isDoorOpened;
  
          newAccessory.context.log = function (msg) { self.log("[" + newAccessory.displayName + "]", msg); };
  
          // Setup HomeKit security systemLoc service
          newAccessory.addService(self.Service.LockMechanism, thislockName);
          newAccessory.addService(self.Service.ContactSensor, thislockName);
          //newAccessory.addService(this.Service.BatteryService);
          // Setup HomeKit accessory information
          self.setAccessoryInfo(newAccessory);
          // Setup listeners for different security system events
          self.setService(newAccessory);
          // Register accessory in HomeKit
          newAccessory.context.log("Adding lock lock to homebridge");
          self.api.registerPlatformAccessories(ModuleName, PlatformName, [newAccessory]);
          isStateChanged = true;
        } else {
          // Retrieve accessory from cache
          var newAccessory = self.accessories[thisDeviceID];
  
          // Update context
          newAccessory.context.deviceID = thisDeviceID;
          newAccessory.context.serialNumber = thisSerialNumber;
          newAccessory.context.model = thisModel;
          newAccessory.context.home = thishome;
  
          // Accessory is reachable after it's found in the server
          newAccessory.updateReachability(true);
  
        }
  
        if (self.batt) {
          newAccessory.context.low = (self.batt > 20) ? self.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL : Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
  
        }
  
        if (state) {
          if (state === "locked") {
            newAccessory.context.initialState = self.Characteristic.LockCurrentState.UNSECURED;
            var newState = self.Characteristic.LockCurrentState.SECURED;
  
          } else if (state === "unlocked") {
            newAccessory.context.initialState = self.Characteristic.LockCurrentState.SECURED;
            var newState = self.Characteristic.LockCurrentState.UNSECURED;
  
          }
  
          // Detect for state changes
          if (newState !== newAccessory.context.currentState) {
            isStateChanged = true;
            newAccessory.context.currentState = newState;
  
          }
  
        }

        if (isDoorOpened != newAccessory.context.doorState) {
          isStateChanged = true;
          newAccessory.context.doorState = isDoorOpened;
  
        }

        // Store accessory in cache
        self.accessories[thisDeviceID] = newAccessory;
  
        // Set validData hint after we found an opener
        self.validData = true;
  
        // Did we have valid data?
        if (self.validData) {
          // Set short polling interval when state changes
          if (isStateChanged) {
            self.count = 0;
          }
          callback();
  
        } else {
          self.platformLog("Error: Couldn't find a August lock device.");
          callback("Missing August Device ID");
  
        }
  
      }, function (error) {
        //self.platformLog(error);
        callback(error, null);
  
      });
  
    }
  
    // Send opener target state to the server
    setState(accessory, state, callback) {
      var self = this;
      var lockCtx = accessory.context;
      var status = self.lockState[state];
      var remoteOperate = (state == self.Characteristic.LockTargetState.SECURED) ? self.augustApi.lock(lockCtx.deviceID) : self.augustApi.unlock(lockCtx.deviceID);
  
      remoteOperate.then(function (result) {
        lockCtx.log("State was successfully set to " + status);
  
        // Set short polling interval
        if (self.tout) {
          clearTimeout(self.tout);
          self.tout = null;
  
        }
        self.count = 0;
        self.periodicUpdate();
        callback(null, state);
  
      }, function (error) {
        lockCtx.log("Error '" + error + "' setting lock state: " + status);
        self.removeAccessory(accessory);
        callback(error);
  
      });
  
    }
  }

  exports.AugustPlatform = AugustPlatform;
