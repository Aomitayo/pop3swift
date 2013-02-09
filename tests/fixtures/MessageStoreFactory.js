var MailComposer = require('mailcomposer').MailComposer;

/*

MessageStore public methods
MessageStore(user)
stat(callback)				-callback(err, length, size)
list(msg, callback)			-callback(err, list)
uidl(msg, callback)			-callback(err, list)
retr(msg, callback)			-callback(err, message)
dele(msg, callback)			-callback(err, success)
rset()
removeDeleted()
*/

function MessageStore(user){
	this.stat = function(callback){
		var count = 0;
		var octetLength = 0;
		this.messages.forEach(function(m){
			if(!m.deleted){
				count++;
				octetLength += m.messageSource.length;
			}
		});
		callback(null, count, octetLength);
	};

	this.list = function(msg, callback){
		var result = [];
		this.messages.forEach(function(m, index){
			if(!m.deleted){
				result.push((index+1)+ " " +m.messageSource.length);
			}
		});
		callback(null, result);
	};
	
	this.uidl = function(msg, callback){
		var result = [];
		this.messages.forEach(function(m, index){
			if(!m.deleted){
				result.push('msg_'+(index+1)+ " " +m.messageSource.length);
			}
		});
		callback(null, result);
	};

	this.retr = function(msg, callback){
		try{
			var m = this.messages[msg-1];
			if(!m){
				callback(null, false);
			}
			callback(null, m.messageSource);
		}
		catch(err){
			callback(null, false);
		}
		
	};
	this.dele = function(msg, callback){
		try{
			this.messages[msg-1].deleted = true;
			callback(null, true);
		}
		catch(err){
			callback(null, false);
		}
	};

	this.rset = function(){
		this.messages.forEach(function(m){
			delete m.deleted;
		});
	};

	this.removeDeleted = function(){
		this.messages = this.messages.filter(function(m){
			return !m.deleted;
		});
	};

	this.messages = [
			{to:'Address1@example.com', from:' Address2@esource.com', text:'@testuser message1', messageSource:'', deleted:false},
			{to:'Address1@wexample.com', from:' Address2@esource.com', text:'@testuser message2', messageSource:'', deleted:false},
			{to:'Address1@yaxample.com', from:' Address2@esource.com', text:'@testuser message3', messageSource:'', deleted:false}
		];

	this.messages.forEach(function(m){
		var mailComposer = new MailComposer();
		mailComposer.setMessageOption(m);
		mailComposer.buildMessage(function(err, messageSource){
			m.messageSource = messageSource;
		});
	});
}

var messageStores = {};
module.exports = function(user, userInfo){
	messageStores[user] = messageStores[user] || new MessageStore(user);
	return messageStores[user];
};