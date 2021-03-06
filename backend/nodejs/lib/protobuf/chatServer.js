var path = require('path');
var ProtoBuf = require("protobufjs");
//console.log(ProtoBuf);
console.log(__dirname);
var ChatProtocolBuffer = ProtoBuf.loadProtoFile(path.join(__dirname, "./ChatProtoBuf.proto"))
        .build("ChatProtocolBuffer"),
    TestProto = ChatProtocolBuffer.TestProto;
console.log(TestProto);

var protocol = require('../protocol');
var MSG = protocol.MSG;
var RESULT = protocol.RESULT;

var socketio = require('socket.io');
var io;
var guestNum = 1;
var userNames = {};
var namesUsed = [];
var currentRoom = {};
var existsRooms = {};

var USER_NAME_PREFIX = 'Guest';
var DEFAULT_ROOM = 'Lobby';

exports.listen = function(server){
    io = socketio.listen(server);
    io.set('log level', 1);

    //console.log(io.sockets);

    io.sockets.on(MSG.connection, function(socket){
        //console.log(io.sockets);
        console.log(socket.id+' connecting...');

        guestNum = assignGuestName(socket, guestNum, userNames, namesUsed);
        joinRoom(socket, DEFAULT_ROOM);

        handleBroadcastMessage(socket, userNames);
        handleChangeUserName(socket, userNames, namesUsed);
        handleJoinOtherRoom(socket);
        handleQueryRooms(socket);
        handleDisconnect(socket, userNames, namesUsed);
    });
}

function assignGuestName(socket, guestNum, userNames, namesUsed){
    var userName = USER_NAME_PREFIX+guestNum;
    userNames[socket.id] = userName;
    socket.emit(RESULT.nameResult, new ChatProtocolBuffer.NameResultProto({
        success:true,
        name:userName
    }).toBuffer());
    namesUsed.push(userName);
    return guestNum+1;
}

function joinRoom(socket, room){
    if(!existsRooms[room]){
        existsRooms[room] = {};
        existsRooms[room][socket.id] = socket.id;
        existsRooms[room].length = 1;
    }else{
        existsRooms[room][socket.id] = socket.id;
        existsRooms[room].length++;
    }

    socket.join(room);
    currentRoom[socket.id] = room;
    socket.emit(RESULT.joinResult, new ChatProtocolBuffer.JoinResultProto({
        room:room
    }).toBuffer());
    socket.broadcast.to(room).emit(MSG.message, new ChatProtocolBuffer.MessageProto({
        text:userNames[socket.id]+' has joined '+room+'!'
    }).toBuffer());

    //console.log(socket.id+' '+room);
    //console.log(io);
    //console.log("\n\n\n");
    //console.log(io.sockets);

    socket.emit(MSG.message, new ChatProtocolBuffer.MessageProto({
        text:usersInRoomSummary(room)
    }).toBuffer());
}

function usersInRoomSummary(room){
    //var usersInRoom = io.sockets.clients(room);
    //var usersInRoom = io.sockets.adapter.rooms[room];
    var usersInRoom = existsRooms[room];
    if(usersInRoom && usersInRoom.length > 0){
        var usersInRoomSummary = 'Users currently in '+room+': ';
        var index = 0;
        for(var key in usersInRoom){
            if(key == 'length'){
                continue;
            }
            var userSocketId = usersInRoom[key]/*.id*/;
            if(index > 0){
                usersInRoomSummary += ', ';
            }
            usersInRoomSummary += userNames[userSocketId];
            index++;
        }
    }
    usersInRoomSummary += '!';
    return usersInRoomSummary;
}

function handleBroadcastMessage(socket, userNames){
    socket.on(MSG.message, function(message){
        message = ChatProtocolBuffer.MessageProto.decode(message);
        socket.broadcast.to(message.room).emit(MSG.message, new ChatProtocolBuffer.MessageProto({
            text:userNames[socket.id]+': '+message.text
        }).toBuffer());
    });
}

function handleChangeUserName(socket, userNames, namesUsed){
    socket.on(MSG.changeName, function(changeNameInfo){
        var userName = ChatProtocolBuffer.ChangeNameCmdProto.decode(changeNameInfo).userName;
        if(userName.indexOf(USER_NAME_PREFIX) == 0){
            socket.emit(RESULT.nameResult, new ChatProtocolBuffer.NameResultProto({
                success:false,
                message:'Names cannot begin with '+USER_NAME_PREFIX+'!'
            }).toBuffer());
        }else{
            if(namesUsed.indexOf(userName) == -1){
                var preUserName = userNames[socket.id];
                var preUserNameIndex = namesUsed.indexOf(preUserName);
                namesUsed.push(userName);
                userNames[socket.id] = userName;
                delete namesUsed[preUserNameIndex];

                socket.emit(RESULT.nameResult, new ChatProtocolBuffer.NameResultProto({
                    success:true,
                    name:userName
                }).toBuffer());
                socket.broadcast.to(currentRoom[socket.id]).emit(MSG.message, new ChatProtocolBuffer.MessageProto({
                    text:preUserName+' is now known as ['+userName+']!'
                }).toBuffer());
            }else{
                socket.emit(RESULT.nameResult, new ChatProtocolBuffer.NameResultProto({
                    success:false,
                    name:'That name is already in use!'
                }).toBuffer());
            }
        }
    });
}

function handleJoinOtherRoom(socket){
    socket.on(MSG.join, function(joinInfo){
        joinInfo = ChatProtocolBuffer.JoinCmdProto.decode(joinInfo);
        var preRoom = currentRoom[socket.id];
        socket.leave(preRoom);
        socket.broadcast.to(preRoom).emit(MSG.message, new ChatProtocolBuffer.MessageProto({
            text:userNames[socket.id]+' changed room to ['+joinInfo.newRoom+']!'
        }).toBuffer());

        deleteFromExistsRooms(socket);
        socket.broadcast.to(preRoom).emit(MSG.message, new ChatProtocolBuffer.MessageProto({
            text:usersInRoomSummary(preRoom)
        }).toBuffer());

        joinRoom(socket, joinInfo.newRoom);
    });
}

function handleQueryRooms(socket){
    socket.on(MSG.rooms, function(){
        //socket.emit(MSG.rooms, existsRooms);

        var rooms = [];
        for(room in existsRooms){
            rooms.push(room);
        }
        socket.emit(MSG.rooms, new ChatProtocolBuffer.RoomsProto({
            rooms:rooms
        }).toBuffer());
    });
}

function handleDisconnect(socket, userNames, namesUsed){
    socket.on(MSG.disconnect, function(){
        var userNameIndex = namesUsed.indexOf(userNames[socket.id]);
        delete namesUsed[userNameIndex];
        delete userNames[socket.id];

        deleteFromExistsRooms(socket);
    });
}

function deleteFromExistsRooms(socket){
    delete existsRooms[currentRoom[socket.id]][socket.id];
    if(--existsRooms[currentRoom[socket.id]].length <= 0){
        delete existsRooms[currentRoom[socket.id]];
    }
}