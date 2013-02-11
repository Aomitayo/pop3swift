var debug = require('debug')('pop3swift:server');
    net = require('net'),
    os = require('os'),
    EventEmitter = require('events').EventEmitter,
    util = require('util');

var POP3_STATE_AUTHENTICATION = 1,
    POP3_STATE_TRANSACTION = 2,
    POP3_STATE_UPDATE = 3,
    RECEIVER_STATE_COMMAND = 1,
    RECEIVER_STATE_RESPONSE = 2;

/**
 * Constructor for a POP3Connection
 *
 * Creates a dedicated server instance for every separate connection. Run by
 * POP3Server after a user tries to connect to the selected port.
 **/
function POP3Connection(socket, connection_id){
    this.socket   = socket;
    
    this.connection_id = connection_id;
    this.UID      = this.connection_id + "." + (+new Date());

    this.pop3State    = POP3_STATE_AUTHENTICATION;
    this.receiverState = RECEIVER_STATE_COMMAND;
    
    this.stringBuffer = '';
    
    socket.on("data", this.onData.bind(this));
    socket.on("end", this.onEnd.bind(this));
}

util.inherits(POP3Connection, EventEmitter);

POP3Connection.prototype.onData = function(data){
    var self = this;
    var lineStack = (self.stringBuffer + data.toString("ascii", 0, data.length)).split('\r\n');
    self.stringBuffer = lineStack.pop();
    lineStack.forEach(function(lineData){
        var evt = self.receiverState == RECEIVER_STATE_COMMAND? 'command' : 'client_response';
        debug("CLIENT %s: %s", evt, lineData);
        self.emit(evt, self, lineData);
    });

    self.updateTimeout();
};

POP3Connection.prototype.onEnd = function(data){
    if(this.pop3State===null)
        return;
    this.pop3State = POP3_STATE_UPDATE;

    if(this.user){
        debug("Closing: "+this.user);
    }
    debug("Connection closed\n\n");
    this.destroy();
};



/**
 * POP3Connection#destroy() -> undefined
 *
 * Clears the used variables just in case (garbage collector should
 * do this by itself)
 **/
POP3Connection.prototype.destroy = function(){
    if(this.timer)clearTimeout(this.timer);
    this.timer = null;
    this.socket = null;
    this.pop3State = null;
    this.authCallback = null;
    this.user = null;
    this.MessageStore = null;
};


POP3Connection.prototype.close = function(){
    this.emit('close', this);
    this.socket.end();
};

/**
 * kill connection after 10 min on inactivity
 **/
POP3Connection.prototype.updateTimeout = function(){
    var self = this;
    if(self.timer)clearTimeout(self.timer);
    self.timer = setTimeout(function(){
        if(!self.socket)
            return;
        if(self.pop3State==POP3_STATE_TRANSACTION)
            self.pop3State = POP3_STATE_UPDATE;
        debug("Connection closed for client inactivity\n\n");
        self.emit('timeout', self);
        self.socket.end();
        self.destroy();
    }, 10*60*1000);
};

POP3Connection.prototype.respond = function(message){
    var response;
    if(typeof message == "string"){
        response = new Buffer(message + "\r\n", "utf-8");
    }else{
        response = Buffer.concat([message, new Buffer("\r\n", "utf-8")]);
    }
    
    debug("SERVER: "+message);
    this.socket.write(response);
};

//pop3 server
function POP3Server(options, makeStore){
    var self = this;
    options = options || {};
    self.options = options;
    self.serverName = options.serverName || os.hostname() || 'localhost';
    self.COUNTER = 0;
    self.userConnections = {};

    self.simpleAuth = options.simpleAuth;
    self.MessageStore = options.messageStore;
    
    self.authMethods = {
        'PLAIN': self.plainAuth.bind(self)
    };

    Object.keys(options.authMethods || {}).forEach(function(k){
        self.authMethods[k] = options.authMethods[k];
    });

    self.capabilities = {
        // AUTHENTICATION
        1: ["UIDL", "USER", "RESP-CODES", "AUTH-RESP-CODE"],
        // TRANSACTION
        2: ["UIDL", "EXPIRE NEVER", "LOGIN-DELAY 0", "IMPLEMENTATION node.js POP3 server"],
        // UPDATE
        3: []
    };
}
util.inherits(POP3Server, EventEmitter);

POP3Server.prototype.listen = function(port, callback){
    var self = this;
    self.server = net.createServer(function(socket){
        var pop3Connection = new POP3Connection(socket, self.COUNTER++);
        self.watchConnection(pop3Connection);
        self.initConnection(pop3Connection);
    });
    self.server.listen(port, callback);
};

POP3Server.prototype.watchConnection = function(connection){
    var self = this;
    connection.on('init', self.initConnection.bind(self) );
    connection.on('command', self.onCommand.bind(self) );
    connection.on('client_response', function(connection, data){debug('client_response: ' + data);});
    connection.on('timeout', self.onTimeout.bind(self) );
    connection.on('close', self.onClose.bind(self));
};

POP3Server.prototype.initConnection = function(connection){
    
    debug('Connection Initialized ' + connection.UID)
    debug("New connection from "+connection.socket.remoteAddress);
    connection.respond("+OK POP3 Server ready <"+connection.UID+"@"+this.serverName+">");
    
};

POP3Server.prototype.onCommand = function(connection, request){
    var cmd = request.match(/^[A-Za-z]+/),
        params = cmd && request.substr(cmd[0].length+1);

    if(!cmd)
        return this.respond("-ERR");

    if(typeof this["cmd"+cmd[0].toUpperCase()]=="function"){
        return this["cmd"+cmd[0].toUpperCase()](connection, params && params.trim());
    }
    
    return connection.respond("-ERR [" + cmd + "] Command not supported");
};

POP3Server.prototype.onTimeout = function(connection){
    var self = this;
    var user = (connection.user || '').trim().toLowerCase();
    if(!user) return;
    delete self.userConnections[user];
};

POP3Server.prototype.onClose = function(connection){
    var self = this;
    var user = (connection.user || '').trim().toLowerCase();
    if(user){
        delete self.userConnections[user];
    }
    connection.respond("+OK POP3 Server signing off");
};


// Universal commands

// CAPA - Reveals server capabilities to the client
POP3Server.prototype.cmdCAPA = function(connection, params){
    if(params && params.length){
        return connection.respond("-ERR Try: CAPA");
    }

    var self = this;
    connection.respond("+OK Capability list follows");
    for(var i=0;i<self.capabilities[connection.pop3State].length; i++){
        connection.respond(self.capabilities[connection.pop3State][i]);
    }

    var methods = Object.keys(self.authMethods);
    if(methods.length && connection.pop3State==POP3_STATE_AUTHENTICATION)
        connection.respond("SASL "+methods.join(" "));
    connection.respond(".");
};

// QUIT - Closes the connection
POP3Server.prototype.cmdQUIT = function(connection){
    var self = this;
    if(connection.pop3State == POP3_STATE_TRANSACTION && connection.messageStore){
        connection.messageStore.removeDeleted();
    }
    connection.close();
};

//AUTHENTICATION MECHANISMS

// USER username - Performs basic authentication, PASS follows
POP3Server.prototype.cmdUSER = function(connection, username){
    if(connection.pop3State != POP3_STATE_AUTHENTICATION)
        return connection.respond("-ERR Only allowed in authentication mode");

    connection.user = username.trim();
    if(!connection.user)
        return connection.respond("-ERR User not set, try: USER <username>");
    return connection.respond("+OK User accepted");
};

// PASS - Performs basic authentication, runs after USER
POP3Server.prototype.cmdPASS = function(connection, password){
    var self = this;
    if(connection.pop3State!=POP3_STATE_AUTHENTICATION)
        return connection.respond("-ERR Only allowed in authentication mode");

    if(!connection.user)
        return connection.respond("-ERR USER not yet set");
    
    this.doSimpleAuth(connection, connection.user, password, function(err, user, info){
        if(err){
            debug(err);
            connection.respond("-ERR [AUTH] Invalid login-" + err.message);
        }
        else{
            connection.user = user;
            connection.userInfo = info;
            self.doLogin(connection, user);
        }
    });
};

// AUTH params_engine - initiates an authentication request
POP3Server.prototype.cmdAUTH = function(connection, params){
    var self = this;
    if(connection.pop3State!=POP3_STATE_AUTHENTICATION)
        return connection.respond("-ERR Only allowed in authentication mode");
    
    if(!params)
        return connection.respond("-ERR Invalid authentication method");
    
    var parts = params.split(" "),
        method = parts.shift().toUpperCase().trim();
    params = parts.join(" ");
    
    // check if the requested authentication method exists and if so, then hand over to it
    if(typeof self.authMethods[method]=="function"){
        connection.receiverState = RECEIVER_STATE_RESPONSE;
        self.authMethods[method](connection, params, function(err, user, info){
            connection.receiverState = RECEIVER_STATE_COMMAND;
            if(err){
                debug(err);
                connection.respond("-ERR [AUTH] Invalid login-" + err.message);
            }
            else{
                connection.user = user;
                connection.userInfo = info;
                self.doLogin(connection, user);
            }
        });
    }else{
        connection.respond("-ERR Unrecognized authentication type");
    }
};

POP3Server.prototype.doSimpleAuth = function(connection, user, password, callback){
    var self = this;
    if(self.simpleAuth){
        if(self.simpleAuth){
            self.simpleAuth(user, password, callback);
        }
    }
    else{
        return callback(new Error('No Implementation for Simple Auth'));
    }
};

/**
 * AUTH PLAIN
 * SCENARIO 1:
 * STEP 1
 *   CLIENT: AUTH PLAIN
 *   SERVER: +
 * STEP 2
 *   CLIENT: BASE64(<NULL>username<NULL>password)
 *   SERVER: +OK logged in
 *
 * SCENARIO 2:
 * STEP 1
 *   CLIENT: AUTH PLAIN BASE64(<NULL>username<NULL>password)
 *   SERVER: +OK logged in
 */
POP3Server.prototype.plainAuth = function(connection, params, callback){
    var self = this;

    function doPlainAuth(credentials){
        var login = new Buffer(credentials, 'base64'),
            parts = login.toString('ascii').split("\u0000");
        if(parts.length!=3 || !parts[1])
            return callback(new Error("Invalid authentication data"));
        if(parts[0].length && parts[0] != parts[1]) // try to log in in behalf of some other user
            return callback(new Error("Not authorized to requested authorization identity"));
        return self.doSimpleAuth(connection, parts[1], parts[2], callback);
    }

    if(!params){ //Scenario 1
        connection.once('client_response', function(connection, response){
            //Step 2
            doPlainAuth(response);
        });
        // Step 1
        connection.respond("+ ");
    }
    else{ //Scenario 2
        //Step 1
        doPlainAuth(params);
    }
};

POP3Server.prototype.doLogin = function(connection, user){
    var self = this;
    user = user.trim().toLowerCase();
    if(!user){
        return connection.respond("-ERR [SYS] Invalid User");
    }
    if(self.userConnections[user]){
        return connection.respond("-ERR [IN-USE] You already have a POP session running");
    }

    if(!self.MessageStore){
        //return connection.respond("-ERR [AUTH] Invalid login")
        return connection.respond("-ERR [SYS] Error with initializing Maildrop");
    }
    var messageStore = typeof self.MessageStore == "function" ? self.MessageStore(user, connection.userInfo) : self.MessageStore;
    var requiredMethods = ['stat', 'list','uidl', 'retr', 'dele', 'rset', 'removeDeleted'],
        supportedMethods = requiredMethods.filter(function(k){return messageStore[k] && true;});
    if(supportedMethods.length != requiredMethods.length){
        return connection.respond("-ERR [SYS] Error with initializing Maildrop.-Unsupported methods");
    }
    else{
        connection.messageStore = messageStore;
    }
    connection.user = user;
    self.userConnections[user] = connection;
    connection.pop3State = POP3_STATE_TRANSACTION;
    connection.respond("+OK You are now logged in");
};

// TRANSACTION commands

// NOOP - always responds with +OK
POP3Server.prototype.cmdNOOP = function(connection){
    if(connection.pop3State!=POP3_STATE_TRANSACTION) return connection.respond("-ERR Only allowed in transaction mode");
    connection.respond("+OK");
};
    
// STAT Lists the total count and bytesize of the messages
POP3Server.prototype.cmdSTAT = function(connection){
    if(connection.pop3State != POP3_STATE_TRANSACTION)
        return connection.respond("-ERR Only allowed in transaction mode");

    connection.messageStore.stat(function(err, length, size){
        if(err){
            connection.respond("-ERR STAT failed");
        }else{
            connection.respond("+OK " + length + " " + size);
        }
    });
};

// LIST [msg] lists all messages
POP3Server.prototype.cmdLIST = function(connection, msg){
    if(connection.pop3State!=POP3_STATE_TRANSACTION)
        return connection.respond("-ERR Only allowed in transaction mode");
    
    connection.messageStore.list(msg, (function(err, list){
        if(err){
            return connection.respond("-ERR LIST command failed");
        }

        if(!list)
            return connection.respond("-ERR Invalid message ID");
        
        if(typeof list == "string"){
            connection.respond("+OK "+list);
        }else{
            connection.respond("+OK");
            for(var i=0; i<list.length; i++){
                connection.respond(list[i]);
            }
            connection.respond(".");
        }
    }).bind(connection));
};

// UIDL - lists unique identifiers for stored messages
POP3Server.prototype.cmdUIDL = function(connection, msg){
    if(connection.pop3State!=POP3_STATE_TRANSACTION)
        return connection.respond("-ERR Only allowed in transaction mode");
    
    connection.messageStore.uidl(msg, (function(err, list){
        if(err){
            return connection.respond("-ERR UIDL command failed");
        }

        if(!list)
            return connection.respond("-ERR Invalid message ID");
        
        if(typeof list == "string"){
            connection.respond("+OK "+list);
        }else{
            connection.respond("+OK");
            for(var i=0; i<list.length; i++){
                connection.respond(list[i]);
            }
            connection.respond(".");
        }
    }).bind(connection));
};

// RETR msg - outputs a selected message
POP3Server.prototype.cmdRETR = function(connection, msg){
    if(connection.pop3State!=POP3_STATE_TRANSACTION) return connection.respond("-ERR Only allowed in transaction mode");
    
    connection.messageStore.retr(msg, (function(err, message){
        if(err){
            return connection.respond("-ERR RETR command failed")
        }
        if(!message){
            return connection.respond("-ERR Invalid message ID");
        }
        connection.respond("+OK "+message.length+" octets");
        connection.respond(message);
        connection.respond(".");
    }).bind(connection));

};

// DELE msg - marks selected message for deletion
POP3Server.prototype.cmdDELE = function(connection, msg){
    if(connection.pop3State != POP3_STATE_TRANSACTION)
        return connection.respond("-ERR Only allowed in transaction mode");
    
    connection.messageStore.dele(msg, (function(err, success){
        if(err){
            return connection.respond("-ERR RETR command failed");
        }
        if(!success){
            return connection.respond("-ERR Invalid message ID");
        }else{
            connection.respond("+OK msg deleted");
        }
    }).bind(connection));

};

// RSET - resets DELE'ted message flags
POP3Server.prototype.cmdRSET = function(connection){
    if(connection.pop3State != POP3_STATE_TRANSACTION)
        return connection.respond("-ERR Only allowed in transaction mode");
    
    connection.messageStore.rset();
    connection.respond("+OK");
};

// EXPORT
module.exports = POP3Server;