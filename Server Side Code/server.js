/**
Copyright (c) 2015 Will Stieh @WStieh

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


* Credit where credit is due
* This project makes use of Azure-Storage-For-Node
* This server.js wraps some of the functions found within Azure-Storage-For-Node
* AzureGhostReplay.js then wraps it up for the client side
* Found here https://github.com/Azure/azure-storage-node  
*/






//Initalize Express
var express = require('express');
var app = express();

//Set the port to either port 80 or the environment's port
var port = process.env.port || 80;

//Build our http server
var http = require('http').Server(app);
//Set up our socket io -- Use this to send and receive information from the clients
var io = require('socket.io')(http);


//Initialize the Azure Connection
var azure = require('azure-storage');
var blobSvc = azure.createBlobService();

//Array of clients
var clients = new Object();

//Some 'constants' for our response function
var LIST_BLOBS = 'sendBlobList';
var FILE_DATA = 'sendFileData';
var NEW_CONTAINER = 'sendContainerResponse';
var DELETE_BLOB = 'sendDeleteBlobResult';
var DELETE_CONTAINER = 'sendDeleteContainerResult';
var CLEAR_CONTAINER = 'sendClearContainerResult';
var WRITE_BLOB = 'sendWriteBlobResult';
var WRITE_FROM_BUFFER = 'sendWriteBufferResult';
var ADD_TO_BUFFER = 'sendAddToBufferResult';
var DEBUG_MESSAGE = 'serverMessage';
var RECEIVE_WRITE_BUFFER = 'sendWriteBuffer';
var CLEAR_WRITE_BUFFER = 'sendClearWriteBufferResult';
var BLOB_EXIST = 'sendBlobExistResult';


//Allow CORS
//This way the game logic doesn't need to be located on the server site
app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

/***********
 * Tell the server to connect to the correct port
************ */
http.listen(port, function () {
  console.log('listening on *:' + port);
});

/******************************
 * Init Function
************************ */
function init() {
  console.log("Init Function");

  setEventHandlers();
}

/*********************
 * Event Handlers for server
 * Sets up the connection event
******************** */
var setEventHandlers = function () {
  console.log("Setting Event Listeners");
  io.on('connection', onSocketConnection);
};

/************************
 * On Socket Connection
 * Fired when a new client connects
********* */
function onSocketConnection(client) {
  
  //A new event is setup here, here specifically because we need access to the client
  client.on('newClient', function (data) {
    //If the id is blank we set it to id generated by nodejs
    if (data.id === "") {
      data.id = client.id;
    }
    //Initialize our new reference
    clients[data.id] = new Object();
    //Set its client id
    clients[data.id].clientId = client.id;
    //Set a reference to its own socket
    clients[data.id].socket = client;
    //Finally we add a write buffer object
    //Here, data can be stored prior to writing it to azure
    clients[data.id].writeBuffer = new Object();
  });
  
  //Setup all of our events
  //Creates a new container, unless it exists
  client.on('createContainerIfNotExists', createContainerIfNotExists);
  //Disconnect event
  client.on('disconnect', onSocketDisconnect);
  //Sends a list of blobs to the client
  client.on('listBlobsInContainer', listBlobsInContainer);
  //Writes to a specific blob
  client.on('writeToBlob', writeToBlob);
 
  //Checks if a blob exists
  client.on('doesBlobExist', doesBlobExist);

  //Reads from a blob
  client.on('readFromBlob', readFromBlob);
  client.on('readFromBlobRaw', readFromBlobRaw);
  
  //Writes to a 'buffer'
  client.on('addToBuffer', addToWriteBuffer);
  client.on('writeFromBuffer', writeFromBuffer);
  client.on('clearWriteBuffer', clearWriteBuffer);
  client.on('getWriteBuffer', getWriteBuffer);


  //Deletes a blob
  client.on('deleteBlob', deleteBlob);
  //Deletes a container
  client.on('deleteContainer', deleteContainer);
  //Clears a container of all its blobs
  client.on('clearContainer', clearContainer);


};


/*********************************
 * Send Data To Client
 * Sends data to a specific client
 * Used by the Read functions and the listBlobsInContainer
******************************** */
function sendResponseToClient(id, responseEvent, data) {
  //Finds the client, gets their socket and emits a message on it
  var socket;
  if (clients.hasOwnProperty(id)) {
    socket = clients[id].socket;
    socket.emit(responseEvent, { data: data });
  } else {
    var clientid = clientById(id)
    if (clientid) {
      socket = clientid.socket;
      socket.emit(responseEvent, { data: data });
    }
  }
};


/**********************
 * Socket Disconnect
************************ */
function onSocketDisconnect(client) {  
  //Remove client from list
  var removeClient = clientById(client.id);
  if (removeClient != false) {
    delete clients[removeClient];
  }

};

/**********************
 * Container Functions
 **********************/

/********************************
 * Create Container If not Exists
 * Creates a new container unless it already exists
********************************* */
function createContainerIfNotExists(data) {
  
  //Check to see if our reference to the azure service exists
  if (data.hasOwnProperty('containerName')) {
    if (typeof blobSvc === 'undefined') {
      blobSvc = azure.createBlobService();
    }

    blobSvc.createContainerIfNotExists(data.containerName, function (error, result, response) {
      if (!error) {
        sendResponseToClient(data.id, NEW_CONTAINER, { Message: "Container Created: " + data.containerName, Result: result, Response: response });
      } else {
        sendResponseToClient(data.id, NEW_CONTAINER, { Message: "Error Creating Container", Error: error, Result: result, Response: response });
      }
    });

  } else {
    //If there is no name, send a debug message
    sendResponseToClient(data.id, NEW_CONTAINER, { Message: "Error Creation Container", Error: "Data Missing Name" });
  }
};

/*************************************
 * Delete Container
 * Deletes a container
************************************ */
function deleteContainer(data) {
  //Check if the blob service is undefined or not
  if (typeof blobSvc === 'undefined') {
    blobSvc = azure.createBlobService();
  }

  blobSvc.deleteContainerIfExists(data.containerName, function (error, result, response) {
    sendResponseToClient(data.id, DELETE_CONTAINER, { Error: error, Response: response, Result: result });
  });

};

/**********************
 * Blob Functions
 **********************/


/******************
 * Checks if a blob exists
****************** */
function doesBlobExist(data) {
  //Check if the blob service is undefined or not
  if (typeof blobSvc === 'undefined') {
    blobSvc = azure.createBlobService();
  }

  blobSvc.doesBlobExist(data.containerName, data.blobName, function (error, result) {
    sendResponseToClient(data.id, BLOB_EXIST, { BlobName: data.blobName, Error: error, Result: result });
  });

};



/****************************
 * Deletes a blob from a container
******************************** */
function deleteBlob(data) {
  //Check if the blob service is undefined or not
  if (typeof blobSvc === 'undefined') {
    blobSvc = azure.createBlobService();
  }

  blobSvc.deleteBlobIfExists(data.containerName, data.blobName, function (error, response) {
    sendResponseToClient(data.id, DELETE_BLOB, { Error: error, Response: response });
  });

};

/***************************
 * Clear Container
 * Clears a container of all container blobs
**************************** */
function clearContainer(data) {
  //In order to clear the container, we get all of the blobs within the container
  //Then delete those blobs
  //This could take some time if the container was expansive. Luckily it happens on the backend!
  
  if (typeof blobSvc === 'undefined') {
    blobSvc = azure.createBlobService();
  }

  blobSvc.listBlobsSegmented(data.containerName, null, function (error, result, response) {
    if (!error) {
      sendResponseToClient(data.id, DEBUG_MESSAGE, { Message: "Clearing Container: " + data.containerName, Error: error, Result: result, Response: response });
      for (var i = 0; i < result.entries.length; i++) {
        //Delete each blob
        blobSvc.deleteBlobIfExists(data.containerName, result.entries[i].name, function (error, response) {
          if (error) {
            sendResponseToClient(data.id, CLEAR_CONTAINER, { Message: "Error Clearing Container: " + data.containerName + " Blob " + result.entries[i].name, Error: error, Result: result, Response: response });
          }
        });
      }
    } else {
      sendResponseToClient(data.id, CLEAR_CONTAINER, { Message: "Error Clearing Container: " + data.containerName, Error: error, Result: result, Response: response });
    }
  });

};


/********************************
 * Write to a blob
********************************* */
function writeToBlob(data, responseEvent) {
  //Check if the blob service is undefined or not
  if (typeof blobSvc === 'undefined') {
    blobSvc = azure.createBlobService();
  }

  var returnEvent = responseEvent || WRITE_BLOB;

  //Check if the blob exists first
  blobSvc.doesBlobExist(data.containerName, data.blobName, function (error, result) {

    //Send a debug message if there is an error and return
    if (error) {
      sendResponseToClient(data.id, returnEvent, { Message: "Error Checking " + data.containerName + "--" + data.blobName + " Existence", Error: error, BlobName: data.blobName });
      return;
    }
    //If it exists, we say we can't write to an existing file
    //We could download and rebuild the blob but that could end in a race condition so at this time it won't be an option
    if (result) {
      sendResponseToClient(data.id, returnEvent, { Error: "Cannot Append to Existing File", BlobName: data.blobName });
    } else {
      //If it doesn't exist create a new one and write to it
      blobSvc.createBlockBlobFromText(data.containerName, data.blobName, data.data, function (error, result, response) {
        sendResponseToClient(data.id, returnEvent, { Error: error, Result: result, Response: response, BlobName: data.blobName });
      });
    }
  });

};

/*****************
 * Add to Write Buffer
 * This is another way of writing to a blob
 * Data is stored here, waiting to be written in one large push
****************** */
function addToWriteBuffer(data) {
  //First, find the correct buffer
  var buffer;
  if (clients.hasOwnProperty(data.id)) {
    buffer = clients[data.id].writeBuffer;
  } else {
    var id = clientById(data.id)
    if (id) {
      buffer = id.writeBuffer;
    }
  }
  
  //If the buffer exists, we continue
  if (buffer) {
    //Set our name
    var name = data.containerName + data.blobName;
    sendResponseToClient(data.id, DEBUG_MESSAGE, { Buffer: buffer, Name: name });
    if (buffer.hasOwnProperty(name)) {
      //if it already exists, we write to it....
      buffer[name] += data.data;
      sendResponseToClient(data.id, ADD_TO_BUFFER, { Message: "Added To Existing Buffer" });
    } else {
      //....or we create it
      buffer[name] = data.data;
      sendResponseToClient(data.id, ADD_TO_BUFFER, { Message: "Created Buffer" });
    }
  } else {
    sendResponseToClient(data.id, ADD_TO_BUFFER, { Error: "Buffer Not Found" });
  }
};



/*****************
 * Returns the write buffer to the client
****************** */
function getWriteBuffer(data) {
  //First, find the correct buffer
  var buffer;
  if (clients.hasOwnProperty(data.id)) {
    buffer = clients[data.id].writeBuffer;
  } else {
    var id = clientById(data.id)
    if (id) {
      buffer = id.writeBuffer;
    }
  }
  
  //If the buffer exists, we continue
  if (buffer) {
    //Set our name
    var name = data.containerName + data.blobName;
    sendResponseToClient(data.id, DEBUG_MESSAGE, { Buffer: buffer, Name: name });
    if (buffer.hasOwnProperty(name)) {
      sendResponseToClient(data.id, RECEIVE_WRITE_BUFFER, { BufferData: buffer[name] });
    } else {
      sendResponseToClient(data.id, RECEIVE_WRITE_BUFFER, { Error: "Buffer is empty" });
    }
  } else {
    sendResponseToClient(data.id, RECEIVE_WRITE_BUFFER, { Error: "Buffer Not Found" });
  }
};

/*****************
 * Clears a write buffer
****************** */
function clearWriteBuffer(data) {
  //First, find the correct buffer
  var buffer;
  if (clients.hasOwnProperty(data.id)) {
    buffer = clients[data.id].writeBuffer;
  } else {
    var id = clientById(data.id)
    if (id) {
      buffer = id.writeBuffer;
    }
  }
  
  //If the buffer exists, we continue
  if (buffer) {
    //Set our name
    var name = data.containerName + data.blobName;
    sendResponseToClient(data.id, DEBUG_MESSAGE, { Buffer: buffer, Name: name });
    if (buffer.hasOwnProperty(name)) {
      buffer[name] = "";
      sendResponseToClient(data.id, CLEAR_WRITE_BUFFER, { Message: "Buffer Cleared" });
    } else {
      sendResponseToClient(data.id, CLEAR_WRITE_BUFFER, { Error: "Buffer not found" });
    }
  } else {
    sendResponseToClient(data.id, CLEAR_WRITE_BUFFER, { Error: "Buffer Not Found" });
  }
};



/**************
 * Write From buffer
 * Writes the data stored in the client's write buffer for this container/blob combination
 * To the blob
********************* */
function writeFromBuffer(data) {
  sendResponseToClient(data.id, DEBUG_MESSAGE, { Message: "Write from Buffer", Data: data });
  
  //First, find the correct buffer
  var buffer;
  //If the client is not false, we add to its write buffer
  if (clients.hasOwnProperty(data.id)) {
    buffer = clients[data.id].writeBuffer;
    sendResponseToClient(data.id, DEBUG_MESSAGE, { Message: "Buffer Found" });
  } else {
    var id = clientById(data.id)
    if (id) {
      buffer = id.writeBuffer;
      sendResponseToClient(data.id, DEBUG_MESSAGE, { Message: "Buffer Found" });
    }
  }

  var textToWrite = '';
  var name = data.containerName + data.blobName;
 
  //If the client is not false, we add to its write buffer
  if (buffer.hasOwnProperty(name)) {
    textToWrite = buffer[name];
  } else {
    sendResponseToClient(data.id, WRITE_FROM_BUFFER, { Error: "No buffer to write from" });
    return;
  }


  //Do some size checking
  //We cannot upload something more then 4mb in one shot
  //After checking on Azure, it appears that each character is 1 bit
  //Which means we can have something like 32,000,000 characters...
  //That is 26,666 pages at 1200 chars a page
  //Unlikely to happen but we will account for it anyway
  if (textToWrite.length >= 32000000) {
    //....by kicking back an error
    sendResponseToClient(data.id, WRITE_FROM_BUFFER, { Error: "Write Buffer is over the 4MB limit", Max: 32000000, Lenght: textToWrite.length, OverBy: (textToWrite.length - 32000000) });
  } else {
    //Write from buffer
    writeToBlob({ id: data.id, containerName: data.containerName, blobName: data.blobName, data: textToWrite }, WRITE_FROM_BUFFER);
    //Clear the buffer
    buffer[name] = "";
  }
};


/*****************************
 * Read From Blob
 * Reads data from a blob
 * This function allows the user to define what portions and how much of the blob to read
****************************** */
function readFromBlob(data) {
  if (typeof blobSvc === 'undefined') {
    blobSvc = azure.createBlobService();
  }
  
  //First we check if it exists
  blobSvc.doesBlobExist(data.containerName, data.blobName, function (error, result) {
    //If theres an error, we send it off and return
    if (error) {
      sendResponseToClient(data.id, FILE_DATA, { Message: "Error Checking for " + data.containerName + " blob " + data.blobName, Error: error, BlobName: data.blobName});
      return;
    }

    //If the blob exists, we read out the portion we need to and send it off
    if (result) {
      blobSvc.getBlobToText(data.containerName, data.blobName, function (error, text, blockBlob, response) {
        if (error) {
          sendResponseToClient(data.id, FILE_DATA, { Message: "Error Getting Existing Blob's data", Error: error, BlobName: data.blobName });
        } else {
          var dataToSend;
          var isEndOfBlob = false;
          if (data.start == -1) {
            dataToSend = text;
            isEndOfBlob = true;
          } else {
            //Since it's text, we split up the blob into pieces, broken up by the passed in separator
            var dataPieces = text.split(data.separator);
            //Do some bounds checking
            if (data.start > dataPieces.length) {
              data.start = dataPieces.length - 1;
            }
            dataToSend = [];
            var lastPart = data.start;
            for (var i = data.start; i < dataPieces.length && i < data.start + data.range; i++) {
              dataToSend.push(dataPieces[i]);
              lastPart++;
            }

            if (lastPart >= dataPieces.length || lastPart === dataPieces.length - 1) {
              isEndOfBlob = true;
            }

          }
          //Return the data, and the last section sent (that way we can go on to the next section)
          sendResponseToClient(data.id, FILE_DATA, { fileData: dataToSend, lastPartSent: lastPart, endOfBlob: isEndOfBlob , BlobName: data.blobName});
        }
      });
    } else {
      sendResponseToClient(data.id, FILE_DATA, { Error: "Blob " + data.containerName + " / " + data.blobName + " does not exist", ServerError: error , BlobName: data.blobName});
    }

  });
};

/*****************************
 * Read From Blob Raw
 * Reads and sends all of the data from the blob
****************************** */
function readFromBlobRaw(data) {

  if (typeof blobSvc === 'undefined') {
    blobSvc = azure.createBlobService();
  }
  
  //Passes the entirety of the blob up as a string in one go
  blobSvc.doesBlobExist(data.containerName, data.blobName, function (error, result) {
    if (error) {
      sendResponseToClient(data.id, FILE_DATA, { Message: "Error Checking for " + data.containerName + " blob " + data.blobName, Error: error , BlobName: data.blobName});
      return;
    }

    if (result) {
      blobSvc.getBlobToText(data.containerName, data.blobName, function (error, text, blockBlob, response) {
        if (error) {
          sendResponseToClient(data.id, FILE_DATA, { Message: "Error Getting Existing Blob's data", Error: error , BlobName: data.blobName});
        } else {
          sendResponseToClient(data.id, FILE_DATA, { fileData: text , BlobName: data.blobName});
        }
      });
    } else {
      sendResponseToClient(data.id, FILE_DATA, { Error: "Blob " + data.containerName + " / " + data.blobName + " does not exist", ServerError: error , BlobName: data.blobName});
    }

  });
};

/***********************
 * List Blobs in Container
 * Gets all the blobs from a container and then sends them up to the client
*********************** */
function listBlobsInContainer(data) {
  //Check if the blob service is undefined or not
  if (typeof blobSvc === 'undefined') {
    blobSvc = azure.createBlobService();
  }

  blobSvc.listBlobsSegmented(data.containerName, null, function (error, result, response) {
    //Send up the result
    if (!error) {
      sendResponseToClient(data.id, LIST_BLOBS, { list: result });
    } else {
      sendResponseToClient(data.id, LIST_BLOBS, { Message: "Error Listing Blobs", Error: error, Result: result, Response: response });
    }
  });

};

/*******************
 * Finds a client by id
 * Loop through all the properites in our clients object,
 * and check if there is one that has the matching id
******************* */
function clientById(id) {
  for (var prop in clients) {
    if (prop.clientId === id) {
      return prop;
    }
  }
  return false;
}


init();