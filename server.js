const express = require('express')
const { createServer } = require('http')
const { Server } = require('socket.io')
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

// Socket.IO配置
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
})

// 存储在线用户
const onlineUsers = new Map()

// 健康检查端点
app.get('/', (req, res) => {
    res.json({
        status: 'WebRTC Signaling Server Running',
        onlineUsers: onlineUsers.size,
        timestamp: new Date().toISOString(),
        version: '1.1.0'
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

// 模拟司机数据
const mockDrivers = [
    {
        id: "driver_1",
        name: "James Smith",
        phone: "+61 412 345 678",
        vehicleType: "sedan",
        vehicleMake: "Toyota",
        vehicleModel: "Camry",
        licensePlate: "ABC-123",
        rating: 4.8,
        isOnline: true,
        status: "available",
        latitude: -37.813,
        longitude: 144.963,
        heading: 45.0,
        lastUpdated: new Date().toISOString()
    },
    {
        id: "driver_2",
        name: "Sarah Johnson",
        phone: "+61 423 456 789",
        vehicleType: "sedan",
        vehicleMake: "Honda",
        vehicleModel: "Accord",
        licensePlate: "XYZ-789",
        rating: 4.9,
        isOnline: true,
        status: "available",
        latitude: -37.814,
        longitude: 144.964,
        heading: 120.0,
        lastUpdated: new Date().toISOString()
    },
    {
        id: "driver_sf_1",
        name: "Robert Kim",
        phone: "+1 415 567 8901",
        vehicleType: "sedan",
        vehicleMake: "BMW",
        vehicleModel: "3 Series",
        licensePlate: "CA-SF005",
        rating: 4.8,
        isOnline: true,
        status: "available",
        latitude: 37.61323,
        longitude: -122.480836,
        heading: 135.0,
        lastUpdated: new Date().toISOString()
    }
]

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

    // 简单的距离过滤
    const nearbyDrivers = mockDrivers.filter(driver => {
        if (!driver.isOnline || driver.status !== 'available') return false

        const distance = calculateDistance(
            userLatitude, userLongitude,
            driver.latitude, driver.longitude
        )

        return distance <= searchRadius
    }).map(driver => ({
        ...driver,
        distance: Math.round(calculateDistance(
            userLatitude, userLongitude,
            driver.latitude, driver.longitude
        ))
    }))

    console.log(`📍 附近司机查询: (${userLatitude.toFixed(3)}, ${userLongitude.toFixed(3)}) 找到 ${nearbyDrivers.length} 个司机`)

    res.json({
        success: true,
        drivers: nearbyDrivers,
        count: nearbyDrivers.length
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
    console.log(`🔗 新连接: ${socket.id}`)

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

    // WebRTC信令消息转发
    socket.on('offer', (data) => {
        console.log(`📤 转发offer: ${socket.id} -> ${data.targetId}`)
        socket.to(data.targetId).emit('offer', {
            offer: data.offer,
            fromId: socket.id
        })
    })

    socket.on('answer', (data) => {
        console.log(`📤 转发answer: ${socket.id} -> ${data.targetId}`)
        socket.to(data.targetId).emit('answer', {
            answer: data.answer,
            fromId: socket.id
        })
    })

    socket.on('ice-candidate', (data) => {
        socket.to(data.targetId).emit('ice-candidate', {
            candidate: data.candidate,
            fromId: socket.id
        })
    })

    // 订单匹配请求
    socket.on('request-ride', (data) => {
        const nearbyDrivers = findNearbyDrivers(data.pickup, 5000) // 5km范围

        if (nearbyDrivers.length > 0) {
            // 向最近的司机发送订单请求
            const closestDriver = nearbyDrivers[0]
            socket.to(closestDriver.id).emit('ride-request', {
                riderId: socket.id,
                pickup: data.pickup,
                destination: data.destination,
                estimatedFare: data.estimatedFare
            })
        } else {
            socket.emit('no-drivers-available')
        }
    })

    // 司机接受订单
    socket.on('accept-ride', (data) => {
        socket.to(data.riderId).emit('ride-accepted', {
            driverId: socket.id,
            estimatedArrival: data.estimatedArrival
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

// 启动服务器
const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
    console.log(`🚀 信令服务器运行在端口 ${PORT}`)
    console.log(`📊 状态页面: http://localhost:${PORT}`)
})

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('🛑 服务器正在关闭...')
    server.close(() => {
        console.log('✅ 服务器已关闭')
        process.exit(0)
    })
})
