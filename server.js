const express = require('express')
const { createServer } = require('http')
const { Server } = require('socket.io')
const WebSocket = require('ws')
const cors = require('cors')

const app = express()
const server = createServer(app)

// 配置CORS
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"]
}))

// 解析JSON请求体
app.use(express.json())

// Socket.IO配置 - 针对Render优化
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: false
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000
})

// 存储在线用户
const onlineUsers = new Map()

// 创建原生WebSocket服务器
const wss = new WebSocket.Server({
    server,
    path: '/ws'
})

// WebSocket连接处理
wss.on('connection', (ws, req) => {
    console.log('🔗 新的WebSocket连接')

    let userId = null

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString())
            console.log('📨 WebSocket收到消息:', message.type)

            switch (message.type) {
                case 'register':
                    userId = message.userId || `user_${Date.now()}`
                    const user = {
                        id: userId,
                        userType: message.userType,
                        location: message.location,
                        ws: ws,
                        lastSeen: Date.now()
                    }
                    onlineUsers.set(userId, user)
                    console.log(`✅ 用户注册: ${userId} (${message.userType})`)
                    if (message.location) {
                        console.log(`📍 注册位置: (${message.location.latitude}, ${message.location.longitude})`)
                    } else {
                        console.log(`⚠️ 注册时没有位置信息`)
                    }

                    // 发送注册确认
                    ws.send(JSON.stringify({
                        type: 'registered',
                        userId: userId,
                        userType: message.userType
                    }))

                    // 如果是乘客，发送司机列表
                    if (message.userType === 'rider') {
                        broadcastDriversToRider(ws)
                    }
                    break

                case 'location-update':
                    if (userId && onlineUsers.has(userId)) {
                        const user = onlineUsers.get(userId)
                        user.location = message.location
                        user.lastSeen = Date.now()
                        console.log(`📍 位置更新: ${userId}`)

                        // 广播位置更新
                        if (user.userType === 'driver') {
                            broadcastDriverLocationToRiders(user)
                        }
                    }
                    break

                case 'request_ride':
                    console.log('🚗 [WebSocket] 收到乘客订单请求:', message)
                    const pickupLocation = {
                        latitude: message.pickup_latitude,
                        longitude: message.pickup_longitude
                    }
                    const nearbyDrivers = findNearbyDriversWS(pickupLocation, 5000) // 5km范围

                    if (nearbyDrivers.length > 0) {
                        // 向最近的司机发送订单请求
                        const closestDriver = nearbyDrivers[0]
                        console.log(`📤 [WebSocket] 向司机 ${closestDriver.id} 发送订单请求`)

                        closestDriver.ws.send(JSON.stringify({
                            type: 'ride_request',
                            ride_id: message.ride_id,
                            rider_id: userId,
                            pickup_latitude: message.pickup_latitude,
                            pickup_longitude: message.pickup_longitude,
                            destination_latitude: message.destination_latitude,
                            destination_longitude: message.destination_longitude,
                            pickup_address: message.pickup_address || '未知地址',
                            destination_address: message.destination_address || '未知地址',
                            estimated_fare: message.estimated_fare,
                            estimated_duration: 15, // 默认15分钟
                            passenger_name: '乘客', // 默认名称
                            timestamp: message.timestamp
                        }))
                    } else {
                        console.log('❌ [WebSocket] 没有可用司机')
                        ws.send(JSON.stringify({
                            type: 'no_drivers_available'
                        }))
                    }
                    break

                case 'accept_ride':
                    console.log('✅ [WebSocket] 司机接受订单:', message)
                    // 找到乘客并通知
                    const rider = onlineUsers.get(message.rider_id)
                    if (rider && rider.ws) {
                        rider.ws.send(JSON.stringify({
                            type: 'ride_accepted',
                            driver_id: userId,
                            ride_id: message.ride_id,
                            estimated_arrival: message.estimated_arrival || 10,
                            timestamp: message.timestamp
                        }))
                    }
                    break

                case 'decline_ride':
                    console.log('❌ [WebSocket] 司机拒绝订单:', message)
                    // 可以在这里实现重新分配给其他司机的逻辑
                    break

                default:
                    console.log('❓ 未知消息类型:', message.type)
            }
        } catch (error) {
            console.error('❌ WebSocket消息解析错误:', error)
        }
    })

    ws.on('close', () => {
        if (userId) {
            onlineUsers.delete(userId)
            console.log(`👋 用户断开连接: ${userId}`)
        }
    })

    ws.on('error', (error) => {
        console.error('❌ WebSocket错误:', error)
    })
})

// 向乘客广播司机列表
function broadcastDriversToRider(riderWs) {
    const drivers = Array.from(onlineUsers.values())
        .filter(user => user.userType === 'driver' && user.location)
        .map(driver => ({
            id: driver.id,
            location: driver.location,
            lastSeen: driver.lastSeen
        }))

    riderWs.send(JSON.stringify({
        type: 'drivers-list',
        drivers: drivers
    }))
}

// 向所有乘客广播司机位置更新
function broadcastDriverLocationToRiders(driver) {
    const riders = Array.from(onlineUsers.values())
        .filter(user => user.userType === 'rider' && user.ws)

    riders.forEach(rider => {
        rider.ws.send(JSON.stringify({
            type: 'driver-location-update',
            driverId: driver.id,
            location: driver.location
        }))
    })
}

// WebSocket版本：查找附近司机
function findNearbyDriversWS(pickupLocation, radiusMeters = 5000) {
    console.log(`🔍 [WebSocket] 查找附近司机，乘客位置: (${pickupLocation.latitude}, ${pickupLocation.longitude})`)

    const allUsers = Array.from(onlineUsers.values())
    console.log(`👥 [WebSocket] 总在线用户: ${allUsers.length}`)

    const driversWithLocation = allUsers.filter(user => {
        const isDriver = user.userType === 'driver'
        const hasLocation = user.location && user.location.latitude && user.location.longitude
        const hasWs = user.ws

        console.log(`🚗 [WebSocket] 用户 ${user.id}: 类型=${user.userType}, 有位置=${hasLocation}, 有连接=${!!hasWs}`)
        if (hasLocation) {
            console.log(`📍 [WebSocket] 用户位置: (${user.location.latitude}, ${user.location.longitude})`)
        }

        return isDriver && hasLocation && hasWs
    })

    console.log(`🚗 [WebSocket] 有位置的司机: ${driversWithLocation.length}`)

    const drivers = driversWithLocation
        .map(driver => {
            // 确保坐标是数字类型
            const pickupLat = parseFloat(pickupLocation.latitude)
            const pickupLng = parseFloat(pickupLocation.longitude)
            const driverLat = parseFloat(driver.location.latitude)
            const driverLng = parseFloat(driver.location.longitude)

            console.log(`📏 [WebSocket] 计算距离: 乘客(${pickupLat}, ${pickupLng}) -> 司机(${driverLat}, ${driverLng})`)

            const distance = calculateDistance(pickupLat, pickupLng, driverLat, driverLng)
            console.log(`📏 [WebSocket] 司机 ${driver.id} 距离: ${distance}米`)
            return { ...driver, distance }
        })
        .filter(driver => driver.distance <= radiusMeters)
        .sort((a, b) => a.distance - b.distance)

    console.log(`🔍 [WebSocket] 找到 ${drivers.length} 个附近司机 (半径${radiusMeters}米)`)
    return drivers
}

// 健康检查端点
app.get('/', (req, res) => {
    res.json({
        status: 'WebRTC Signaling Server Running',
        onlineUsers: onlineUsers.size,
        timestamp: new Date().toISOString(),
        version: '1.3.0',
        socketIO: 'enabled',
        nativeWebSocket: 'enabled',
        transports: ['websocket', 'polling', 'native-ws']
    })
})

// 清理过期用户端点
app.post('/cleanup', (req, res) => {
    const beforeCount = onlineUsers.size
    const now = Date.now()
    const expiredTime = 5 * 60 * 1000 // 5分钟过期

    // 清理过期用户
    for (const [userId, user] of onlineUsers.entries()) {
        if (now - user.lastSeen > expiredTime) {
            onlineUsers.delete(userId)
            console.log(`🧹 清理过期用户: ${userId}`)
        }
    }

    const afterCount = onlineUsers.size
    const cleanedCount = beforeCount - afterCount

    res.json({
        status: 'cleanup completed',
        beforeCount,
        afterCount,
        cleanedCount,
        timestamp: new Date().toISOString()
    })

    console.log(`🧹 清理完成: 清理了 ${cleanedCount} 个过期用户`)
})

// 强制清理所有用户端点（仅用于开发测试）
app.post('/reset', (req, res) => {
    const beforeCount = onlineUsers.size
    onlineUsers.clear()

    res.json({
        status: 'all users cleared',
        beforeCount,
        afterCount: 0,
        timestamp: new Date().toISOString()
    })

    console.log(`🧹 强制清理: 清理了 ${beforeCount} 个用户`)
})

// Socket.IO健康检查
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        socketIO: {
            enabled: true,
            connections: onlineUsers.size,
            transports: ['websocket', 'polling']
        },
        timestamp: new Date().toISOString()
    })
})

// 获取在线用户统计
app.get('/stats', (req, res) => {
    const drivers = Array.from(onlineUsers.values()).filter(user => user.userType === 'driver')
    const riders = Array.from(onlineUsers.values()).filter(user => user.userType === 'rider')

    res.json({
        total: onlineUsers.size,
        drivers: drivers.length,
        riders: riders.length,
        driverList: drivers.map(d => ({ id: d.id, location: d.location }))
    })
})

// 健康检查端点（兼容iOS应用）
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        onlineUsers: onlineUsers.size
    })
})

// 动态生成附近司机的函数
function generateNearbyDrivers(userLat, userLng, radius = 1000) {
    const drivers = []
    const driverCount = Math.floor(Math.random() * 4) + 2 // 2-5个司机

    const driverNames = [
        "James Smith", "Sarah Johnson", "Robert Kim", "Emily Chen",
        "Michael Brown", "Lisa Wang", "David Wilson", "Anna Lee"
    ]

    const vehicleData = [
        { type: "sedan", make: "Toyota", model: "Camry" },
        { type: "sedan", make: "Honda", model: "Accord" },
        { type: "sedan", make: "BMW", model: "3 Series" },
        { type: "suv", make: "Mazda", model: "CX-5" },
        { type: "sedan", make: "Hyundai", model: "Elantra" }
    ]

    for (let i = 0; i < driverCount; i++) {
        // 在用户位置方圆radius米内随机生成司机位置
        const radiusInDegrees = radius / 111000 // 大约111km = 1度
        const randomAngle = Math.random() * 2 * Math.PI
        const randomDistance = Math.random() * radiusInDegrees

        const driverLat = userLat + (randomDistance * Math.cos(randomAngle))
        const driverLng = userLng + (randomDistance * Math.sin(randomAngle))

        const vehicle = vehicleData[Math.floor(Math.random() * vehicleData.length)]
        const name = driverNames[Math.floor(Math.random() * driverNames.length)]

        drivers.push({
            id: `driver_${Date.now()}_${i}`,
            name: name,
            phone: `+61 4${Math.floor(Math.random() * 90000000) + 10000000}`,
            vehicleType: vehicle.type,
            vehicleMake: vehicle.make,
            vehicleModel: vehicle.model,
            licensePlate: `${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}-${Math.floor(Math.random() * 900) + 100}`,
            rating: Math.round((Math.random() * 1.5 + 4.0) * 10) / 10, // 4.0-5.0
            isOnline: true,
            status: "available",
            latitude: driverLat,
            longitude: driverLng,
            heading: Math.floor(Math.random() * 360),
            lastUpdated: new Date().toISOString()
        })
    }

    return drivers
}

// API路由

// 获取附近司机
app.get('/api/nearby-drivers', (req, res) => {
    const { userLat, userLng, radius = 5000 } = req.query

    if (!userLat || !userLng) {
        return res.status(400).json({ error: '需要用户位置信息' })
    }

    const userLatitude = parseFloat(userLat)
    const userLongitude = parseFloat(userLng)
    const searchRadius = parseFloat(radius)

    // 动态生成附近司机
    console.log(`🔍 用户位置: (${userLatitude.toFixed(4)}, ${userLongitude.toFixed(4)})`)
    console.log(`📏 搜索半径: ${searchRadius}米`)

    const nearbyDrivers = generateNearbyDrivers(userLatitude, userLongitude, searchRadius)
        .map(driver => ({
            ...driver,
            distance: Math.round(calculateDistance(
                userLatitude, userLongitude,
                driver.latitude, driver.longitude
            ))
        }))

    console.log(`🚗 生成了 ${nearbyDrivers.length} 个司机`)
    nearbyDrivers.forEach((driver, index) => {
        console.log(`  司机${index + 1}: (${driver.latitude.toFixed(4)}, ${driver.longitude.toFixed(4)}) 距离: ${driver.distance}m`)
    })

    console.log(`📍 附近司机查询: (${userLatitude.toFixed(3)}, ${userLongitude.toFixed(3)}) 找到 ${nearbyDrivers.length} 个司机`)

    res.json({
        success: true,
        drivers: nearbyDrivers,
        count: nearbyDrivers.length
    })
})

// 司机状态查询 (GET) - 用于测试
app.get('/api/driver-status', (req, res) => {
    res.json({
        success: true,
        message: '司机状态API端点正常工作',
        info: 'POST请求用于更新状态，GET请求用于测试',
        timestamp: new Date().toISOString()
    })
})

// 司机状态更新 (POST)
app.post('/api/driver-status', (req, res) => {
    const { driverId, isOnline, status, latitude, longitude } = req.body

    if (!driverId) {
        return res.status(400).json({
            success: false,
            message: '需要司机ID'
        })
    }

    console.log(`🚗 司机状态更新: ${driverId} -> 在线:${isOnline}, 状态:${status}`)

    // 模拟更新成功 - 包含iOS应用期望的所有字段
    res.json({
        success: true,
        message: '司机状态更新成功',
        driver: {
            id: driverId,
            name: `司机 ${driverId.slice(-3)}`, // 添加name字段
            phone: "+61 400000000",
            vehicleType: "sedan",
            vehicleMake: "Toyota",
            vehicleModel: "Camry",
            licensePlate: `SF-${Math.floor(Math.random() * 1000)}`,
            rating: 4.8,
            isOnline: isOnline,
            status: status || 'available',
            latitude: latitude || 37.7749,
            longitude: longitude || -122.4194,
            heading: 0,
            lastUpdated: new Date().toISOString()
        }
    })
})

// 司机状态变化通知
app.get('/api/driver-status-changes', (req, res) => {
    const { lastUpdate = '0' } = req.query
    const lastUpdateTime = new Date(parseInt(lastUpdate))

    // 模拟状态变化
    const recentChanges = mockDrivers
        .filter(driver => new Date(driver.lastUpdated) > lastUpdateTime)
        .map(driver => ({
            driver_id: driver.id,
            is_online: driver.isOnline,
            status: driver.status,
            latitude: driver.latitude,
            longitude: driver.longitude,
            lastUpdated: driver.lastUpdated
        }))

    res.json({
        success: true,
        changes: recentChanges,
        timestamp: new Date().toISOString()
    })
})

// 简单的距离计算函数
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3 // 地球半径 (米)
    const φ1 = lat1 * Math.PI/180
    const φ2 = lat2 * Math.PI/180
    const Δφ = (lat2-lat1) * Math.PI/180
    const Δλ = (lon2-lon1) * Math.PI/180

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))

    return R * c // 距离 (米)
}

// WebSocket连接处理
io.on('connection', (socket) => {
    console.log(`🔗 新连接: ${socket.id} from ${socket.handshake.address}`)

    // 连接错误处理
    socket.on('connect_error', (error) => {
        console.log(`❌ 连接错误: ${socket.id} - ${error.message}`)
    })

    socket.on('disconnect', (reason) => {
        console.log(`🔌 连接断开: ${socket.id} - ${reason}`)
        onlineUsers.delete(socket.id)
        broadcastUserList()
    })

    // 用户注册
    socket.on('register', (data) => {
        const userInfo = {
            id: socket.id,
            userType: data.userType, // 'driver' or 'rider'
            location: data.location,
            timestamp: Date.now()
        }

        onlineUsers.set(socket.id, userInfo)
        console.log(`✅ ${data.userType} ${socket.id} 已注册`)

        // 广播用户列表更新
        broadcastUserList()
    })

    // 位置更新
    socket.on('location-update', (data) => {
        const user = onlineUsers.get(socket.id)
        if (user) {
            user.location = data.location
            user.timestamp = Date.now()

            // 只向乘客广播司机位置
            if (user.userType === 'driver') {
                socket.broadcast.emit('driver-location-update', {
                    driverId: socket.id,
                    location: data.location
                })
            }
        }
    })

    // WebRTC信令消息转发 - 增强版
    socket.on('offer', (data) => {
        console.log(`📤 [WebRTC] 转发offer: ${socket.id} -> ${data.targetId}`)
        const targetUser = onlineUsers.get(data.targetId)
        if (targetUser) {
            socket.to(data.targetId).emit('offer', {
                offer: data.offer,
                fromId: socket.id,
                timestamp: Date.now()
            })
            console.log(`✅ [WebRTC] Offer已转发给 ${data.targetId}`)
        } else {
            console.log(`❌ [WebRTC] 目标用户 ${data.targetId} 不在线`)
            socket.emit('user_not_found', { targetId: data.targetId })
        }
    })

    socket.on('answer', (data) => {
        console.log(`📤 [WebRTC] 转发answer: ${socket.id} -> ${data.targetId}`)
        const targetUser = onlineUsers.get(data.targetId)
        if (targetUser) {
            socket.to(data.targetId).emit('answer', {
                answer: data.answer,
                fromId: socket.id,
                timestamp: Date.now()
            })
            console.log(`✅ [WebRTC] Answer已转发给 ${data.targetId}`)
        } else {
            console.log(`❌ [WebRTC] 目标用户 ${data.targetId} 不在线`)
            socket.emit('user_not_found', { targetId: data.targetId })
        }
    })

    socket.on('ice-candidate', (data) => {
        console.log(`📤 [WebRTC] 转发ICE候选者: ${socket.id} -> ${data.targetId}`)
        const targetUser = onlineUsers.get(data.targetId)
        if (targetUser) {
            socket.to(data.targetId).emit('ice-candidate', {
                candidate: data.candidate,
                fromId: socket.id,
                timestamp: Date.now()
            })
        } else {
            console.log(`❌ [WebRTC] 目标用户 ${data.targetId} 不在线`)
        }
    })

    // P2P订单消息转发（当WebRTC DataChannel不可用时的备用方案）
    socket.on('p2p_order_request', (data) => {
        console.log(`📋 [P2P] 转发订单请求: ${socket.id} -> ${data.targetId}`)
        const targetUser = onlineUsers.get(data.targetId)
        if (targetUser) {
            socket.to(data.targetId).emit('p2p_order_request', {
                orderRequest: data.orderRequest,
                fromId: socket.id,
                timestamp: Date.now()
            })
            console.log(`✅ [P2P] 订单请求已转发给司机 ${data.targetId}`)
        } else {
            console.log(`❌ [P2P] 司机 ${data.targetId} 不在线`)
            socket.emit('driver_not_available', { driverId: data.targetId })
        }
    })

    socket.on('p2p_order_response', (data) => {
        console.log(`📋 [P2P] 转发订单响应: ${socket.id} -> ${data.targetId}`)
        const targetUser = onlineUsers.get(data.targetId)
        if (targetUser) {
            socket.to(data.targetId).emit('p2p_order_response', {
                orderResponse: data.orderResponse,
                fromId: socket.id,
                timestamp: Date.now()
            })
            console.log(`✅ [P2P] 订单响应已转发给乘客 ${data.targetId}`)
        } else {
            console.log(`❌ [P2P] 乘客 ${data.targetId} 不在线`)
        }
    })

    // 订单匹配请求 - 修复消息类型匹配问题
    socket.on('request_ride', (data) => {
        console.log('🚗 收到乘客订单请求:', data)
        const pickupLocation = {
            latitude: data.pickup_latitude,
            longitude: data.pickup_longitude
        }
        const nearbyDrivers = findNearbyDrivers(pickupLocation, 5000) // 5km范围

        if (nearbyDrivers.length > 0) {
            // 向最近的司机发送订单请求
            const closestDriver = nearbyDrivers[0]
            console.log(`📤 向司机 ${closestDriver.id} 发送订单请求`)

            socket.to(closestDriver.id).emit('ride_request', {
                type: 'ride_request',
                ride_id: data.ride_id,
                rider_id: socket.id,
                pickup_latitude: data.pickup_latitude,
                pickup_longitude: data.pickup_longitude,
                destination_latitude: data.destination_latitude,
                destination_longitude: data.destination_longitude,
                pickup_address: data.pickup_address || '未知地址',
                destination_address: data.destination_address || '未知地址',
                estimated_fare: data.estimated_fare,
                estimated_duration: 15, // 默认15分钟
                passenger_name: '乘客', // 默认名称
                timestamp: data.timestamp
            })
        } else {
            console.log('❌ 没有可用司机')
            socket.emit('no_drivers_available')
        }
    })

    // 司机接受订单 - 修复消息类型匹配问题
    socket.on('accept_ride', (data) => {
        console.log('✅ 司机接受订单:', data)
        socket.to(data.rider_id).emit('ride_accepted', {
            type: 'ride_accepted',
            driver_id: socket.id,
            ride_id: data.ride_id,
            estimated_arrival: data.estimated_arrival || 10,
            timestamp: data.timestamp
        })
    })

    // 断开连接
    socket.on('disconnect', () => {
        const user = onlineUsers.get(socket.id)
        if (user) {
            console.log(`❌ ${user.userType} ${socket.id} 已断开`)
            onlineUsers.delete(socket.id)
            broadcastUserList()
        }
    })
})

// 广播用户列表
function broadcastUserList() {
    const drivers = Array.from(onlineUsers.values())
        .filter(user => user.userType === 'driver')
        .map(driver => ({
            id: driver.id,
            location: driver.location,
            timestamp: driver.timestamp
        }))

    // 只向乘客发送司机列表
    onlineUsers.forEach((user, socketId) => {
        if (user.userType === 'rider') {
            io.to(socketId).emit('drivers-list', drivers)
        }
    })
}

// 查找附近司机
function findNearbyDrivers(location, radiusMeters) {
    const drivers = Array.from(onlineUsers.values())
        .filter(user => user.userType === 'driver' && user.location)

    return drivers
        .map(driver => ({
            ...driver,
            distance: calculateDistance(location, driver.location)
        }))
        .filter(driver => driver.distance <= radiusMeters)
        .sort((a, b) => a.distance - b.distance)
}

// 计算距离 (简化版)
function calculateDistance(pos1, pos2) {
    const R = 6371e3 // 地球半径 (米)
    const φ1 = pos1.latitude * Math.PI/180
    const φ2 = pos2.latitude * Math.PI/180
    const Δφ = (pos2.latitude-pos1.latitude) * Math.PI/180
    const Δλ = (pos2.longitude-pos1.longitude) * Math.PI/180

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))

    return R * c
}

// 防止Render休眠的保活机制
function keepAlive() {
    setInterval(() => {
        const now = new Date().toISOString()
        console.log(`💓 [${now}] 保活心跳 - 在线用户: ${onlineUsers.size}`)
    }, 10 * 60 * 1000) // 每10分钟发送一次心跳
}

// 启动服务器
const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
    console.log(`🚀 信令服务器运行在端口 ${PORT}`)
    console.log(`📊 状态页面: http://localhost:${PORT}`)

    // 启动保活机制
    keepAlive()
    console.log(`💓 保活机制已启动，每10分钟发送心跳`)
})

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('🛑 服务器正在关闭...')
    server.close(() => {
        console.log('✅ 服务器已关闭')
        process.exit(0)
    })
})
