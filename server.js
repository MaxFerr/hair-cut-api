const express=require('express');
const bodyParser=require('body-parser');
const cors=require('cors');
const knex=require('knex');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require("crypto");
const multer = require("multer");
const fs = require('fs');


const check=(data)=>{
	if (data.split('').filter(x => x === '{').length >= 1) {
		return true
	}else{
		return false
	}
}

const storage = multer.diskStorage({
	// storing images in public/uploads
   destination: "./public/uploads/",
   // renaming the file like that we don't have files with the same name
   filename: function(req, file, cb){
      cb(null,"IMAGE-" + Date.now() + '-' +file.originalname);
   }
});

const upload = multer({
   storage: storage,
   // check if the file name contain .jpg etc.. (needs to be change check magical number)
   fileFilter: function (req, file, cb) {
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
        return cb(new Error('Only image files are allowed!'));
    }
    cb(null, true);
  },
  // set the size of the file (3mb)
   limits:{fileSize: 3000000},
}).single("myImage");

//connecting db to server with knex, heroku app
const db=knex({
	client:'pg',
	connection:{
		connectionString:process.env.DATABASE_URL,
		ssl: true		
	}
});

const app=express();
app.use(bodyParser.json());
app.use(cors());

//Serving static files(images)
app.use('/public', express.static(__dirname + '/public'));

//getting all the articles from the db ordered by id
app.get('/',(req,res)=>{
	db.select('*').from('articles').orderBy('m_article_id','desc')
	.then(article=>{
		res.json(article)
	})
})

//getting a single article selected by id
app.get('/article/:id',(req,res)=>{
	//getting id from the FE
	const {id}=req.params;
	//selecting the corresponding article where id from FE = id from db	
	db.select('*').from('articles').where('m_article_id','=',id)
	.then(article=>{
		res.json(article[0])
	})
})

app.post('/register',(req,res)=>{
	//getting email,name,password from FE	
	const {email,name,password}=req.body;
	//check if email,name... have a { to avoid bad codes -> securty. I should make a function of this
		//if data received from FE are empty or contain { return error
	if(!email||	check(email) ||	!name||	check(name)|| !password||check(password)){
		return res.status(400).json('Incorrect form.')
	}else{
		//using bcrypt to encrypt user's password
		bcrypt.genSalt(10, function(err, salt) {
   		 bcrypt.hash(password, salt, function(err, hash) {
   		 	//using knex's transaction to work on multiple tables at the same time
        db.transaction(trx=>{
        	//inserting hashed password and email to the login table
		trx.insert({
			password:hash,
			email:email
		})
		.into('login')
		.returning('email')
		.then(loginEmail=>{

		return trx('users')
			.returning('*')
			//inserting email,name,joined to the users table
			.insert({
				email:loginEmail[0],
				name:name,
				joined: new Date()
			})
			.then(user=>{
				//sending last user's info to the FE
				res.json(user[0])
			})
		})
		.then(trx.commit)
		.catch(trx.rollback)
	})
		.catch(err=>res.status(400).json('Email or username already used.'))
		})
    });
	}
	
});

app.post('/login',(req,res)=>{
	//getting email,password from FE
	const {email,password}=req.body;
	//check if email,name... have a { to avoid bad codes -> securty. I should make a function of this
		//if data received from FE are empty or contain { return error
	if(!email||	check(email)||!password||check(password)){
		return res.status(400).json('Incorrect form.')
	}else{
		//selecting email,password from login's table where FE email= db email
		db.select('email','password').from('login')
		.where('email','=',email)
		.then(loginInfo=>{
			//comparing the FE password with the crypted password in db
		bcrypt.compare(password, loginInfo[0].password, function(err, check) {
		//if there are no errors /check is true		 
			if(check) {
				//select users's data from users table where  email(users table) =  email(login table)
				return db.select('*').from('users')
				.where('email','=',loginInfo[0].email)
				.then(user=>{
					//sending user's info to the FE (from the users table so there is no password sent)
					res.json(user[0])
				})
				.catch(err=>res.status(400).json('unable to connect'))
			}else {
				res.status(400).json('error')
			} 
		});		
	})
	.catch(err=>res.status(400).json('Wrong password or email.'))
	}	
})

app.post('/newarticle',(req,res)=>{
	const {image,title,secondtitle,text,added,favorite,user}=req.body;
	if(image!='Unable to upload that file' && Number(user)===Number(process.env.admin_id)){
		db('articles')
		.returning('*')
		//inserting new article's data to the db (if the image is a link)
		.insert({
			image:image,		
			title:title,
			secondtitle:secondtitle,
			text:text,
			added:added,
			favorite:favorite
		})
		.then(article=>{
			res.json(article[0])
		})
		.catch(err=> res.status(400).json('Unable to add that article'))
	}else{
		res.status(400).json('Unable to add that article')
	}
	
	
})

app.post('/upload',(req,res)=>{
	//using multer to upload file
	upload(req, res, function (err) {
	 if (err instanceof multer.MulterError) {
      return res.status(400).json('Unable to upload that file')
    } else if (err) {
      return res.status(400).json('Unable to upload that file')
    } 
    //creating a file path
   const host = req.hostname;
   //changing "\" to "/"
   const modifLink=(path)=>{
   		let newPath='';
   		const slash='\\';
   	for (var i = 0; i < path.length; i++) {
   		if(path[i]=== slash){
   			newPath=newPath+"/"
   		}else{
   			newPath=newPath+path[i]
   		}
   	}   	
   	return newPath;
   }
	const filePath = req.protocol + "://" + host + '/' + modifLink(req.file.path);	
	/*Change :3001 later when it's deployed*/
	//sending the filepath to the FE. If the FE recieve a valid file path. it will send that path to the newarticle route
	return res.json(filePath)
  })	
})

app.put('/modifArticle',(req,res)=>{				
	const { title,secondtitle,text,favorite,image,oldImagePath,m_article_id,user } = req.body;
	if(Number(user)===Number(process.env.admin_id)){
	db('articles').where('m_article_id','=',m_article_id )
	//updating article's info
	.update({
		image:image,
	    title: title,
	    secondtitle: secondtitle,
	    text: text,
	    favorite: favorite
	  	})
	.returning('*')
	.then(article=>{		
		res.json(article[0])
	})
	.catch(err=>res.status(400).json('Unable to get that article.'))
	//deleting the old image if the old image has a path
		if(oldImagePath!==undefined){
			const delImagePath = oldImagePath;		
		const NewDelPath=delImagePath.replace(req.protocol + "://" + host, '.');		
		/*const host = req.hostname; replace 'http://localhost:3001' */
		fs.unlink(NewDelPath, (err) => {
		  if (err) {		    
		    return 'Could not delete that file.'
		  }
		  return 'File removed.'
		})
	}
	}else{
		res.status(400).json('Unable to update that file')
	}	
})

app.get('/comments/:id',(req,res)=>{
	//getting comments from one article 
	const {id}=req.params;
	db.from('comments').innerJoin('users', 'comments.user_id', 'users.m_user_id')
	.where('article_id','=',id)
	.then(comments=>{
		res.json(comments)
	})
})


app.post('/sendComment',(req,res)=>{	
	const {article_id,comment,user_id,added}=req.body;
	if(!user_id || !comment||check(comment) ){
		return res.status(400).json('Incorrect form.')
	}else{
	db('comments')
	.returning('*')
	//inserting comment's data to the db
	.insert({
		article_id:article_id,		
		comment:comment,
		user_id:user_id,
		added:added		
	})
	.then(comment=>{
		res.json(comment[0])
	})
	.catch(err=> res.status(400).json('Unable to add that comment.'))
	}	
})


app.get('/commentresponse/:id',(req,res)=>{
	//getting comments's answer from one article 
	const {id}=req.params;
	db.from('commentsresp').innerJoin('users', 'commentsresp.user_id', 'users.m_user_id')
	.where('article_id','=',id)
	.then(commentsresp=>{
		res.json(commentsresp)
	})
})


app.post('/sendResponse',(req,res)=>{	
	const {article_id,comment,user_id,added,comment_id}=req.body;
	if(!user_id || !comment||check(comment) ){
		return res.status(400).json('Incorrect form.')
	}else{
	db('commentsresp')
	.returning('*')
	//inserting answer's data to the db
	.insert({
		article_id:article_id,		
		resp:comment,
		user_id:user_id,
		added:added,
		comment_id:comment_id	
	})
	.then(ResponseComment=>{
		res.json(ResponseComment[0])
	})
	.catch(err=> res.status(400).json('Unable to add that comment.'))
	}	
})

//not used right now cause we can't save uploaded file on heroku
app.delete('/deleteArticle/:id',(req,res)=>{
	const {id,oldImagePath,user}=req.body;	
	 if(Number(user)===Number(process.env.admin_id)){
	 	//delete commentsresp then comments then file/image then article at the same time so using transaction
	 	db.transaction(trx=>{
		trx('commentsresp')
		.returning('commentsresp.article_id')
		.where('commentsresp.article_id','=',id)
		.del()
		.then(article_id=>{
			//delete comments
		return trx('comments')
			.returning('*')
			.where('comments.article_id','=',id)
			.del()			
			.then(article_id=>{
				//delete image if it's not undefined
				if(oldImagePath!==undefined){
				const delImagePath = oldImagePath;		
				const NewDelPath=delImagePath.replace(req.protocol + "://" + host, '.');		
				/*const host = req.hostname; replace 'http://localhost:3001' */
				fs.unlink(NewDelPath, (err) => {
				  if (err) {
				    console.error(err)
				    return 'Could not delete that file.'
				  }
				  return console.log('File removed.')
				})
			}
			//delete article
				return trx('articles')
				.returning('*')
				.where('m_article_id','=',id)
				.del()											
			})
		}).then(articles=>{
					res.json(articles[0])
				})	
		.then(trx.commit)
		.catch(trx.rollback)
	})
		.catch(err=>res.status(400).json('Article could not be deleted.'))	
	}else{
		res.status(400).json('Article could not be deleted.')
	}
	 
})

app.delete('/deleteArticleS/:id',(req,res)=>{
	const {id,oldImagePath,user}=req.body;	
	 if(Number(user)===Number(process.env.admin_id)){
	 	//delete commentsresp then comments  then article at the same time so using transaction
	 	db.transaction(trx=>{
		trx('commentsresp')
		.returning('commentsresp.article_id')
		.where('commentsresp.article_id','=',id)
		.del()
		.then(article_id=>{
		return trx('comments')
			.returning('*')
			.where('comments.article_id','=',id)
			.del()			
			.then(article_id=>{				
				return trx('articles')
				.returning('*')
				.where('m_article_id','=',id)
				.del()											
			})
		}).then(articles=>{
					res.json(articles[0])
				})	
		.then(trx.commit)
		.catch(trx.rollback)
	})
		.catch(err=>res.status(400).json('Article could not be deleted.'))	
	}else{
		res.status(400).json('Article could not be deleted.')
	}
	 
})

app.delete('/deleteComment/:id',(req,res)=>{
	const {id,user}=req.body;
	if(Number(user)===Number(process.env.admin_id)){
		//delete  comments but first we need to delete commentsresp
		db.transaction(trx=>{
		trx('commentsresp')
		.returning('commentsresp.comment_id')
		.where('commentsresp.comment_id','=',id)
		.del()
		.then(article_id=>{
		return trx('comments')
			.returning('*')
			.where('m_comment_id','=',id)
			.del()	
		}).then(comment=>{
					res.json(comment[0])
				})	
		.then(trx.commit)
		.catch(trx.rollback)
	})
		.catch(err=>res.status(400).json('Comment could not be deleted.'))
	}else{
		res.status(400).json('Comment could not be deleted.')
	}	
	 	
})


app.delete('/deleteCommentResp/:id',(req,res)=>{
	const {id,user}=req.body;
	if(Number(user)===Number(process.env.admin_id)){
		db('commentsresp')
		.returning('*')
		.where('m_commentresp_id','=',id)
		.del()
		.then(ResponseComment=>{
			res.json(ResponseComment[0])
		})
	.catch(err=> res.status(400).json('Unable to delete that response.'))
	}else{
		res.status(400).json('Unable to delete that response.')
	}	
})

app.post('/sendmail',(req,res)=>{
	//using nodemailer to send email
	const {name,email,message,user}=req.body;
	if(!email||	check(email)||!name||check(name)||!message||check(message) || !user ){
		return res.status(400).json('Incorrect info.')
	}
		let transporter = nodemailer.createTransport({
			//used email
					service: 'yahoo',		        
					auth: {
		            user: 'TestNodemailerYelcamp@yahoo.com', 
		            pass: `${process.env.email_pass}` 
		        }
		    });	
				let mailOptions = {
					//receive email
		        from: 'TestNodemailerYelcamp@yahoo.com', 
		        to: 'ferromassimo1989@gmail.com', 
		        subject: 'Work', 
		        text: `Email:${email} Name:${name} Message:${message}`
		      };
		      transporter.sendMail(mailOptions, (error, info) => {
		      	if (error) {
		      		return res.json('email not sent');
		      	}
		      	res.json('email sent')		      	
		      });	      
	
})

app.post('/forgot',(req,res)=>{	
	const {email}=req.body;
	if(!email||	check(email)){
		return res.status(400).json('Incorrect info.')
	}else{
	db('users')
	.where('email','=',email)	
	.then(user=>{
		if(user[0]){
		//creating a token		
			const token=crypto.randomBytes(20).toString('hex');
			//setting expires time
			const expires=Number(Date.now())+ 3600000;
			db('login')			
			.where('email','=',email)
			//sending token and expires to the db									
			.update({
				resetpasstoken:token,				
				resetpassexpires:expires			
			})
			.returning(['resetpasstoken'])
			.then(data=>{
				res.json('data sent.')
				//sending a mail to the user				
				let transporter = nodemailer.createTransport({
					service: 'yahoo',		        
					auth: {
		            user: 'TestNodemailerYelcamp@yahoo.com', 
		            pass: `${process.env.email_pass}` 
		        }
		    });	
				let mailOptions = {
		        from: 'TestNodemailerYelcamp@yahoo.com', // sender address
		        to: user[0].email, // list of receivers
		        subject: 'Hello', // Subject line
		        text: 'You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n' +
		        'Please click on the following link, or paste this into your browser to complete the process:\n\n' +
		        'https://hair-style.herokuapp.com/ResetPassword/' + data[0].resetpasstoken + '\n\n' +
		        'If you did not request this, please ignore this email and your password will remain unchanged.\n' // plain text body
		      };
		      transporter.sendMail(mailOptions, (error, info) => {
		      	if (error) {
		      		return console.log(error);
		      	}
		      	console.log('Message sent: %s', info.messageId);
		      	console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
		      });
		  })
		}else{
			return res.json('Wrong email !')
		}
	})
	.catch(err=> res.status(400).json('err'))
	}
});

app.get('/resetPass/:token',(req,res)=>{
	const {token}=req.params;
	db('login')			
	.where('resetpasstoken','=',token)
	.returning(['resetpassexpires','email'])
	.then(data=>{
		if(data[0]){
			// if token isnt expired reset the password (sending user's email to FE)
			if(Number(data[0].resetpassexpires)>Date.now()){				
				res.json({email:data[0].email})
			}else{
				res.json('Password reset token has expired.')				
			}
		}else{
			res.json('Password reset token is invalid')
		}
	})
	.catch(err=> res.status(400).json('err'))
})

app.put('/updatePassword',(req, res)=>{
	const { resetpasstoken,password } = req.body;
	if(!password||	check(password)){
		return res.status(400).json('Incorrect info.')
	}else{
	bcrypt.genSalt(10, function(err, salt){
	bcrypt.hash(password, salt, function(err, hash) {
	db('login').where('resetpasstoken','=',resetpasstoken )
	.update({
	    resetpasstoken: null,
	    resetpassexpires: null,
	    password: hash	      
	  	})
	  	.returning('email')	
	.then(email=>{
		res.json({email:email[0]})
	})
	.catch(err=>res.status(400).json('Unable to reset your password.'))
		})
	})	
	}	
})


app.get('/admin/:id',(req,res)=>{
	//admin check
	const {id}=req.params;
	if(Number(id)===Number(process.env.admin_id)){
		return res.json(process.env.admin_id)
	}else{
		return res.status(400).json('Error.')
	}		
})


app.listen(process.env.PORT || 3001,()=>{console.log("app is running on port "+process.env.PORT)});