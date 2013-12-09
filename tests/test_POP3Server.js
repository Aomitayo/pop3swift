var expect = require('chai').expect,
	net = require('net'),
	POP3Client = require('poplib'),
	POP3Server = require('../').Server,
	PORT = 5050;
	
describe('POP3 server', function(){
	var pop3Server;

	before(function(done){
		var messageStore = {}, authHandler = {};
		pop3Server = new POP3Server({
			simpleAuth: function(username, password, callback){

				if(/(^jdoe$)|(^jdoe2$)/.test(username) && password == 'correct_password'){
					return callback(null, username, {username:username});
				}
				else{
					return callback(new Error('Invalid Username or password'));
				}
			},
			messageStore: require('./fixtures/MessageStoreFactory')
		});
		pop3Server.listen(PORT, done);
	});

	it('It should be listening on the appropriate port', function(done){
		var client = net.connect(PORT, function(){
			done();
		});
		client.on('error', function(err){
			done(err);
		});
	});

	it('It should Respond with banner on new Connection', function(done){
		var client = net.connect(PORT, function(){});
		client.on('error', function(err){
			done(err);
		});
		client.on('data', function(chunk){
			expect(chunk.toString('ascii')).to.match(/^\+OK/);
			return done();
		});
	});
	it('Should support QUIT command', function(done){
		var client = new POP3Client(PORT, 'localhost', false);
		client.on('connect', function(){
			client.quit();
		});
		client.on('quit', function(status, rawData){
			expect(status).to.be.true;
			done();
		});
		client.on('error', done);
	});

	it('Should Accept valid Login credentials via USER-PASS sequence', function(done){
		var client = new POP3Client(PORT, 'localhost', false);
		client.on('connect', function(){ client.login('jdoe', 'correct_password');});
		client.on('login', function(status){
			expect(status).to.be.true;
			client.quit();
		});
		client.on('quit', function(){done();});
		client.on('error', done);
	});

	it('Should Reject invalid Login credentials via USER-PASS sequence', function(done){
		var client = new POP3Client(PORT, 'localhost', false);
		client.on('connect', function(){ client.login('jdoe', 'wrong_password');});
		client.on('login', function(status){
			expect(status).to.be.false;
			client.quit();
		});
		client.on('quit', function(){done();});
		client.on('error', done);
	});

	it('Should support CAPA command', function(done){
		var client = new POP3Client(PORT, 'localhost', false);
		client.on('connect', function(){
			client.capa();
		});
		client.on('capa', function(status, data, rawData){
			expect(status).to.be.true;
			done();
		});
		client.on('error', done);
	});

	it('Should support PLAIN Auth', function(done){
		var client = new POP3Client(PORT, 'localhost', {enabletls:false, ignoretlserrs:true});
		client.on('connect', function(){
			client.capa();
		});
		client.on('capa', function(status, data, rawData){
			expect(status).to.be.true;
			var sasl = data.filter(function(capa){
				return (/^SASL /).test(capa);
			})[0];
			expect(sasl).to.have.string(' PLAIN');
			client.data['tls'] = client.data['stls'] = true;	//skip stls
			client.auth('PLAIN', 'jdoe', 'correct_password');
		});
		client.on('auth', function(status, rawData){
			expect(status).to.be.true;
			client.quit();
		});
		client.on('quit', function(status){done();});
		client.on('error', done);
	});

	it('Should Reject invalid Login credentials via Plain AUTH', function(done){
		var client = new POP3Client(PORT, 'localhost', false);
		client.on('connect', function(){
			client.data['tls'] = client.data['stls'] = true;	//skip stls
			client.auth('PLAIN', 'jdoe', 'wrong_password');
		});
		client.on('auth', function(status, rawData){
			expect(status).to.be.false;
			client.quit();
		});
		client.on('quit', function(){done();});
		client.on('error', done);
	});

	it('Should Reject multiple active connections', function(done){
		var client1 = new POP3Client(PORT, 'localhost', false);
		var client2;
		client1.on('connect', function(){ client1.login('jdoe', 'correct_password');});
		client1.on('login', function(status){
			expect(status).to.be.true;
			var client2 = new POP3Client(PORT, 'localhost', false);
			client2.on('connect', function(){ client2.login('jdoe', 'correct_password');});
			client2.on('login', function(status){
				expect(status).to.be.false;
				client2.quit();
			});
			client2.on('quit', function(){client1.quit();});
			client2.on('error', done);
		});
		client1.on('quit', function(){done();});
		client1.on('error', done);
	});

	it('Should Accept multiple connections from different users', function(done){
		var client1 = new POP3Client(PORT, 'localhost', false);
		var client2;
		client1.on('connect', function(){ client1.login('jdoe', 'correct_password');});
		client1.on('login', function(status){
			expect(status).to.be.true;
			var client2 = new POP3Client(PORT, 'localhost', false);
			client2.on('connect', function(){ client2.login('jdoe2', 'correct_password');});
			client2.on('login', function(status){
				expect(status).to.be.true;
				client2.quit();
			});
			client2.on('quit', function(){client1.quit();});
			client2.on('error', done);
		});
		client1.on('quit', function(){done();});
		client1.on('error', done);
	});

	it('Should Properly support the NOOP command', function(done){
		var client = new POP3Client(PORT, 'localhost', false);
		client.on('connect', function(){ client.login('jdoe', 'correct_password');});
		client.on('login', function(status){
			expect(status).to.be.true;
			client.noop();
		});
		client.on('noop', function(status, rawData){
			expect(status).to.be.true;
			client.quit();
		});
		client.on('quit', function(){done();});
		client.on('error', done);
	});

	it('Should Properly support the STAT command', function(done){
		var client = new POP3Client(PORT, 'localhost', false);
		client.on('connect', function(){ client.login('jdoe', 'correct_password');});
		client.on('login', function(status){
			expect(status).to.be.true;
			client.stat();
		});
		client.on('stat', function(status, data, rawData){
			expect(status).to.be.true;
			expect(data.count).to.equal('3');
			client.quit();
		});
		client.on('quit', function(){done();});
		client.on('error', done);
	});

	it('Should Properly support the LIST command', function(done){
		var client = new POP3Client(PORT, 'localhost', false);
		client.on('connect', function(){ client.login('jdoe', 'correct_password');});
		client.on('login', function(status){
			expect(status).to.be.true;
			client.list();
		});
		client.on('list', function(status, msgCount, msgNumber, data, rawData){
			expect(status).to.be.true;
			expect(msgCount).to.equal(3);
			client.quit();
		});
		client.on('quit', function(){done();});
		client.on('error', done);
	});

	it('Should Properly support the UIDL command', function(done){
		var client = new POP3Client(PORT, 'localhost', false);
		client.on('connect', function(){ client.login('jdoe', 'correct_password');});
		client.on('login', function(status){
			expect(status).to.be.true;
			client.uidl();
		});
		client.on('uidl', function(status, msgNumber, data, rawData){
			expect(status).to.be.true;
			var expectedIds = ['msg_1', 'msg_2', 'msg_3'],
				returnedIds = Object.keys(data),
				matchingIds = returnedIds.filter(function(k){return expectedIds.indexOf(k) != -1;});
			expect(matchingIds).to.have.length(expectedIds.length);
			client.quit();
		});
		client.on('quit', function(){done();});
		client.on('error', done);
	});

	it('Should Properly support the RETR command', function(done){
		var client = new POP3Client(PORT, 'localhost', false);
		client.on('connect', function(){ client.login('jdoe', 'correct_password');});
		client.on('login', function(status){
			expect(status).to.be.true;
			client.retr(2);
		});
		client.on('retr', function(status, msgNumber, data, rawData){
			expect(status).to.be.true;
			expect(msgNumber).to.equal(2);
			expect(data).to.have.string('@testuser message2');
			client.quit();
		});
		client.on('quit', function(){done();});
		client.on('error', done);
	});

	it('Should Properly support the DELE and RSET command', function(done){
		var client = new POP3Client(PORT, 'localhost', false);
		client.on('connect', function(){ client.login('jdoe', 'correct_password');});
		client.on('login', function(status){
			expect(status).to.be.true;
			client.dele(1);
		});
		client.on('dele', function(status, msgNumber, rawData){
			expect(status).to.be.true;
			expect(msgNumber).to.equal(1);
			client.once('stat', function(status, data, rawData){
				expect(status).to.be.true;
				expect(data.count).to.equal('2');
				client.rset();
			});
			client.stat();
		});
		client.on('rset', function(status, rawData){
			expect(status).to.be.true;
			client.once('stat', function(status, data, rawData){
				expect(status).to.be.true;
				expect(data.count).to.equal('3');
				client.quit();
			});
			client.stat();
		});
		client.on('quit', function(){done();});
		client.on('error', done);
	});

	it('Should error on invalid non-command strings', function(done){
		var responses = [/^\+OK/, /^\-ERR/].reverse();
		var client = net.connect(PORT);
		client.on('error', function(err){
			done(err);
		});
		client.on('data', function(chunk){
			expect(chunk.toString('ascii')).to.match(responses.pop());
			if(responses.length == 0) return done();
			else client.write("9\r\n");
		});
	});

	it('Should have persistent Deletions', function(done){
		var client1 = new POP3Client(PORT, 'localhost', false);
		var client2;
		client1.on('connect', function(){ client1.login('jdoe', 'correct_password');});
		client1.on('login', function(status){
			expect(status).to.be.true;
			client1.dele(1);
		});
		client1.on('dele', function(status){
			expect(status).to.be.true;
			client1.quit();
		});
		client1.on('quit', function(status){
			expect(status).to.be.true;
			var client2 = new POP3Client(PORT, 'localhost', false);
			client2.on('connect', function(){ client2.login('jdoe', 'correct_password');});
			client2.on('login', function(status){
				expect(status).to.be.true;
				client2.stat();
			});
			
			client2.on('stat', function(status, data, rawData){
				expect(status).to.be.true;
				expect(data.count).to.equal('2');
				client2.quit();
			});
			client2.on('quit', function(){done();});
			client2.on('error', done);
		});
		client1.on('error', done);
	});
});
