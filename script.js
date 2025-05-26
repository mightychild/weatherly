// API Keys and URLs
const WEATHER_API_KEY = '1362459dfaf30dd3ae6abdab69b81c7a';
const GEOCODING_API_URL = 'https://api.openweathermap.org/geo/1.0';
const WEATHER_API_URL = 'https://api.openweathermap.org/data/2.5/weather';
const FORECAST_API_URL = 'https://api.openweathermap.org/data/2.5/forecast';
const AIR_POLLUTION_API_URL = 'https://api.openweathermap.org/data/2.5/air_pollution';

// DOM Elements
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const locationBtn = document.getElementById('location-btn');
const loading = document.getElementById('loading');

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    updateDate();
    getWeatherByLocation(); // Try to get user's location by default
    
    // Event listeners
    searchBtn.addEventListener('click', handleSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });
    locationBtn.addEventListener('click', getWeatherByLocation);
});

function handleSearch() {
    const query = searchInput.value.trim();
    if (query) {
        getWeatherByCity(query);
    }
}

// Get weather by city name, country, or region
async function getWeatherByCity(query) {
    showLoading();
    try {
        // Get coordinates first
        const geoData = await fetch(`${GEOCODING_API_URL}/direct?q=${query}&limit=5&appid=${WEATHER_API_KEY}`);
        const geoJson = await geoData.json();
        
        if (geoJson.length === 0) {
            alert('Location not found. Please try another search.');
            hideLoading();
            return;
        }
        
        // Use the first result by default
        const { lat, lon, name, country, state } = geoJson[0];
        
        // Update search input with the official location name
        const displayName = state ? `${name}, ${state}, ${country}` : `${name}, ${country}`;
        searchInput.value = displayName;
        
        // Get all weather data
        await Promise.all([
            updateWeatherData(lat, lon, name, country, state),
            updateNearbyCities(lat, lon)
        ]);
        
        // Show notification for precipitation
        const weatherData = await fetch(`${WEATHER_API_URL}?lat=${lat}&lon=${lon}&units=metric&appid=${WEATHER_API_KEY}`);
        const weatherJson = await weatherData.json();
        const weatherMain = weatherJson.weather[0].main;
        if (['Rain', 'Thunderstorm', 'Snow'].includes(weatherMain)) {
            showNotification('Weather Alert', `Expect ${weatherMain.toLowerCase()} in your area.`);
        }
        
    } catch (error) {
        console.error('Error fetching weather data:', error);
        alert('Error fetching weather data. Please try again.');
    } finally {
        hideLoading();
    }
}

// Get weather by user's location
function getWeatherByLocation() {
    showLoading();
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;
                try {
                    // Get city name from coordinates
                    const geoData = await fetch(`${GEOCODING_API_URL}/reverse?lat=${latitude}&lon=${longitude}&limit=1&appid=${WEATHER_API_KEY}`);
                    const geoJson = await geoData.json();
                    
                    if (geoJson.length === 0) {
                        alert('Location not found. Please try again.');
                        hideLoading();
                        return;
                    }
                    
                    const { name, country, state } = geoJson[0];
                    const displayName = state ? `${name}, ${state}, ${country}` : `${name}, ${country}`;
                    searchInput.value = displayName;
                    
                    // Get all weather data
                    await Promise.all([
                        updateWeatherData(latitude, longitude, name, country, state),
                        updateNearbyCities(latitude, longitude)
                    ]);
                    
                    // Show notification for precipitation
                    const weatherData = await fetch(`${WEATHER_API_URL}?lat=${latitude}&lon=${longitude}&units=metric&appid=${WEATHER_API_KEY}`);
                    const weatherJson = await weatherData.json();
                    const weatherMain = weatherJson.weather[0].main;
                    if (['Rain', 'Thunderstorm', 'Snow'].includes(weatherMain)) {
                        showNotification('Weather Alert', `Expect ${weatherMain.toLowerCase()} in your area.`);
                    }
                    
                } catch (error) {
                    console.error('Error fetching location data:', error);
                    alert('Error fetching location data. Please try again.');
                } finally {
                    hideLoading();
                }
            },
            (error) => {
                console.error('Geolocation error:', error);
                // Fallback to a default city if location access is denied
                getWeatherByCity("London");
            }
        );
    } else {
        // Geolocation not supported - fallback to default city
        getWeatherByCity("London");
    }
}

// Update all weather data for a location
async function updateWeatherData(lat, lon, name, country, state) {
    try {
        const [weatherData, forecastData] = await Promise.all([
            fetch(`${WEATHER_API_URL}?lat=${lat}&lon=${lon}&units=metric&appid=${WEATHER_API_KEY}`),
            fetch(`${FORECAST_API_URL}?lat=${lat}&lon=${lon}&units=metric&appid=${WEATHER_API_KEY}`)
        ]);
        
        const weatherJson = await weatherData.json();
        const forecastJson = await forecastData.json();
        
        // Update UI
        const displayName = state ? `${name}, ${state}, ${country}` : `${name}, ${country}`;
        updateCurrentWeather(weatherJson, displayName);
        updateForecast(forecastJson);
        updateAirQuality(lat, lon);
        updateWeatherMap(lat, lon);
    } catch (error) {
        console.error('Error updating weather data:', error);
        throw error;
    }
}

// Update nearby cities data
async function updateNearbyCities(lat, lon) {
    try {
        // First get city names around the location (limited to 5 for demo)
        const response = await fetch(`${GEOCODING_API_URL}/reverse?lat=${lat}&lon=${lon}&limit=5&appid=${WEATHER_API_KEY}`);
        const citiesData = await response.json();
        
        // Get weather for each nearby city
        const citiesWithWeather = await Promise.all(
            citiesData.map(async city => {
                const weatherRes = await fetch(`${WEATHER_API_URL}?lat=${city.lat}&lon=${city.lon}&units=metric&appid=${WEATHER_API_KEY}`);
                const weather = await weatherRes.json();
                return {
                    name: city.name,
                    country: city.country,
                    state: city.state,
                    distance: calculateDistance(lat, lon, city.lat, city.lon),
                    temp: Math.round(weather.main.temp),
                    icon: weather.weather[0].icon,
                    desc: weather.weather[0].main
                };
            })
        );
        
        // Update UI
        updateNearbyCitiesUI(citiesWithWeather);
    } catch (error) {
        console.error('Error fetching nearby cities:', error);
        // Silently fail - nearby cities is secondary feature
    }
}

// Calculate distance between two coordinates in km
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c);
}

// Update current weather UI
function updateCurrentWeather(data, location) {
    document.getElementById('location').textContent = location;
    document.getElementById('temp').textContent = `${Math.round(data.main.temp)}°C`;
    document.getElementById('weather-desc').textContent = data.weather[0].description;
    document.getElementById('feels-like').textContent = `${Math.round(data.main.feels_like)}°C`;
    document.getElementById('humidity').textContent = `${data.main.humidity}%`;
    document.getElementById('wind').textContent = `${Math.round(data.wind.speed * 3.6)} km/h`;
    document.getElementById('pressure').textContent = `${data.main.pressure} hPa`;
    
    // Set weather icon
    const iconCode = data.weather[0].icon;
    document.getElementById('weather-icon').src = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
    document.getElementById('weather-icon').alt = data.weather[0].main;
    
    // Update sunrise and sunset times
    const sunriseTime = new Date(data.sys.sunrise * 1000);
    const sunsetTime = new Date(data.sys.sunset * 1000);
    document.getElementById('sunrise').textContent = sunriseTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('sunset').textContent = sunsetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // UV index (simulated based on temperature and conditions)
    let uvIndex;
    if (data.weather[0].main === 'Rain') {
        uvIndex = Math.random() * 2; // Low UV when raining
    } else {
        uvIndex = Math.min(data.main.temp / 5 + Math.random() * 2, 12); // Higher UV with higher temps
    }
    document.getElementById('uv-value').textContent = uvIndex.toFixed(1);
    updateUIStyle(uvIndex, 'uv-value', 'uv-text', [
        { max: 2, text: 'Low', color: '#2ecc71' },
        { max: 5, text: 'Moderate', color: '#f1c40f' },
        { max: 7, text: 'High', color: '#e67e22' },
        { max: 10, text: 'Very High', color: '#e74c3c' },
        { max: Infinity, text: 'Extreme', color: '#8e44ad' }
    ]);
    
    // Update advice based on weather
    updateWeatherAdvice(data);
    
    // Update weather alerts
    updateWeatherAlerts(data);
}

// Update forecast UI
function updateForecast(data) {
    const forecastContainer = document.getElementById('forecast-container');
    forecastContainer.innerHTML = '';
    
    // Group forecast by day
    const dailyForecast = {};
    data.list.forEach(item => {
        const date = new Date(item.dt * 1000);
        const dateStr = date.toLocaleDateString();
        
        if (!dailyForecast[dateStr]) {
            dailyForecast[dateStr] = {
                temps: [],
                icons: [],
                desc: item.weather[0].description,
                main: item.weather[0].main,
                date: date
            };
        }
        
        dailyForecast[dateStr].temps.push(item.main.temp);
        dailyForecast[dateStr].icons.push(item.weather[0].icon);
    });
    
    // Get the next 5 days
    const forecastDays = Object.values(dailyForecast).slice(0, 5);
    
    forecastDays.forEach(day => {
        const dayName = day.date.toLocaleDateString('en-US', { weekday: 'short' });
        const avgTemp = day.temps.reduce((a, b) => a + b, 0) / day.temps.length;
        const maxTemp = Math.max(...day.temps);
        const minTemp = Math.min(...day.temps);
        
        // Use the most frequent icon or first one
        const iconCounts = {};
        day.icons.forEach(icon => {
            iconCounts[icon] = (iconCounts[icon] || 0) + 1;
        });
        const mostFrequentIcon = Object.keys(iconCounts).reduce((a, b) => 
            iconCounts[a] > iconCounts[b] ? a : b
        );
        
        const forecastItem = document.createElement('div');
        forecastItem.className = 'forecast-item';
        
        forecastItem.innerHTML = `
            <div class="forecast-day">${dayName}</div>
            <img class="forecast-icon" src="https://openweathermap.org/img/wn/${mostFrequentIcon}.png" alt="${day.main}">
            <p class="forecast-desc">${day.desc}</p>
            <div class="forecast-temp">
                <span class="forecast-max">${Math.round(maxTemp)}°</span>
                <span class="forecast-min">${Math.round(minTemp)}°</span>
            </div>
        `;
        
        forecastContainer.appendChild(forecastItem);
    });
}

// Update nearby cities UI
function updateNearbyCitiesUI(cities) {
    const container = document.getElementById('nearby-cities-container');
    container.innerHTML = '';
    
    // Skip the first city (it's the current one)
    const nearbyCities = cities.slice(1);
    
    nearbyCities.forEach(city => {
        const cityCard = document.createElement('div');
        cityCard.className = 'city-card';
        cityCard.addEventListener('click', () => {
            const query = city.state ? `${city.name}, ${city.state}, ${city.country}` : `${city.name}, ${city.country}`;
            searchInput.value = query;
            getWeatherByCity(query);
        });
        
        cityCard.innerHTML = `
            <div class="city-name">${city.name}, ${city.country}</div>
            <div class="city-distance">${city.distance} km away</div>
            <div class="city-weather">
                <div class="city-temp">${city.temp}°C</div>
                <img class="city-icon" src="https://openweathermap.org/img/wn/${city.icon}.png" alt="${city.desc}">
            </div>
        `;
        
        container.appendChild(cityCard);
    });
}

// Update weather advice
function updateWeatherAdvice(data) {
    const adviceContainer = document.getElementById('advice-container');
    adviceContainer.innerHTML = '';
    
    const temp = data.main.temp;
    const weatherMain = data.weather[0].main;
    const weatherDesc = data.weather[0].description;
    const humidity = data.main.humidity;
    const windSpeed = data.wind.speed;
    const uvIndex = parseFloat(document.getElementById('uv-value').textContent);
    
    const adviceList = [];
    
    // Temperature advice
    if (temp > 30) {
        adviceList.push({
            icon: 'fas fa-temperature-high',
            title: 'Hot Weather Advisory',
            text: 'Drink plenty of water to stay hydrated. Avoid prolonged sun exposure and wear light, loose clothing.'
        });
    } else if (temp < 10) {
        adviceList.push({
            icon: 'fas fa-temperature-low',
            title: 'Cold Weather Advisory',
            text: 'Wear layers including a warm sweater or jacket. Protect extremities from cold with gloves and hats.'
        });
    }
    
    // Precipitation advice
    if (['Rain', 'Drizzle', 'Thunderstorm'].includes(weatherMain)) {
        adviceList.push({
            icon: 'fas fa-umbrella',
            title: 'Rain Advisory',
            text: 'Carry an umbrella or raincoat. Expect slippery roads and possible travel delays.'
        });
    } else if (weatherMain === 'Snow') {
        adviceList.push({
            icon: 'fas fa-snowflake',
            title: 'Snow Advisory',
            text: 'Wear waterproof boots and warm layers. Be cautious of icy surfaces when walking.'
        });
    }
    
    // Wind advice
    if (windSpeed > 20) {
        adviceList.push({
            icon: 'fas fa-wind',
            title: 'Wind Advisory',
            text: 'Secure loose outdoor items. Be cautious when driving high-profile vehicles.'
        });
    }
    
    // UV advice
    if (uvIndex >= 6) {
        adviceList.push({
            icon: 'fas fa-sun',
            title: 'UV Protection Needed',
            text: 'Apply SPF 30+ sunscreen. Wear sunglasses and a wide-brimmed hat. Seek shade during midday hours.'
        });
    }
    
    // Humidity advice
    if (humidity > 70) {
        adviceList.push({
            icon: 'fas fa-water',
            title: 'High Humidity',
            text: 'Stay hydrated. Consider using dehumidifiers indoors. Be aware of possible mold growth.'
        });
    } else if (humidity < 30) {
        adviceList.push({
            icon: 'fas fa-tint',
            title: 'Low Humidity',
            text: 'Use moisturizers and lip balm. Consider a humidifier to prevent dry skin and respiratory irritation.'
        });
    }
    
    // Default advice if no specific conditions
    if (adviceList.length === 0) {
        adviceList.push({
            icon: 'fas fa-check-circle',
            title: 'Pleasant Weather',
            text: 'Conditions are ideal for outdoor activities. Enjoy the nice weather!'
        });
    }
    
    // Add clothing recommendation
    adviceList.push(generateClothingAdvice(temp, weatherMain));
    
    // Add travel advice
    adviceList.push(generateTravelAdvice(weatherMain, windSpeed));
    
    // Display all advice
    adviceList.forEach(advice => {
        const adviceCard = document.createElement('div');
        adviceCard.className = 'advice-card';
        adviceCard.innerHTML = `
            <i class="${advice.icon} advice-icon"></i>
            <div class="advice-content">
                <h4>${advice.title}</h4>
                <p>${advice.text}</p>
            </div>
        `;
        adviceContainer.appendChild(adviceCard);
    });
}

// Generate clothing advice
function generateClothingAdvice(temp, weatherMain) {
    let clothingAdvice = '';
    let icon = 'fas fa-tshirt';
    
    if (temp > 25) {
        clothingAdvice = 'Light clothing like t-shirts and shorts are recommended. Choose breathable fabrics.';
    } else if (temp > 18) {
        clothingAdvice = 'Light layers are ideal. Consider a light jacket or sweater for cooler evenings.';
    } else if (temp > 10) {
        clothingAdvice = 'Wear a jacket or sweater. Consider thermal layers if sensitive to cold.';
    } else if (temp > 0) {
        clothingAdvice = 'Dress warmly with multiple layers. Winter coat, hat, and gloves recommended.';
        icon = 'fas fa-mitten';
    } else {
        clothingAdvice = 'Extreme cold weather gear needed. Heavy coat, insulated gloves, hat, and scarf essential.';
        icon = 'fas fa-icicles';
    }
    
    // Adjust for precipitation
    if (['Rain', 'Drizzle'].includes(weatherMain)) {
        clothingAdvice += ' Waterproof outer layer recommended.';
        icon = 'fas fa-umbrella';
    } else if (weatherMain === 'Snow') {
        clothingAdvice += ' Waterproof and insulated boots essential.';
        icon = 'fas fa-snowplow';
    }
    
    return {
        icon: icon,
        title: 'Clothing Recommendation',
        text: clothingAdvice
    };
}

// Generate travel advice
function generateTravelAdvice(weatherMain, windSpeed) {
    let travelAdvice = '';
    let icon = 'fas fa-car';
    let title = 'Travel Conditions';
    
    switch(weatherMain) {
        case 'Rain':
            travelAdvice = 'Wet roads may increase stopping distances. Allow extra travel time.';
            icon = 'fas fa-car-crash';
            break;
        case 'Snow':
            travelAdvice = 'Snow may create hazardous driving conditions. Consider postponing non-essential travel.';
            icon = 'fas fa-snowplow';
            title = 'Winter Travel Advisory';
            break;
        case 'Thunderstorm':
            travelAdvice = 'Avoid travel during thunderstorms. If driving, be alert for sudden wind gusts and reduced visibility.';
            icon = 'fas fa-bolt';
            title = 'Storm Travel Advisory';
            break;
        case 'Fog':
            travelAdvice = 'Reduced visibility expected. Use low-beam headlights and increase following distance.';
            icon = 'fas fa-fog';
            break;
        default:
            if (windSpeed > 15) {
                travelAdvice = 'Windy conditions may affect high-profile vehicles. Secure loose items in truck beds.';
                icon = 'fas fa-wind';
            } else {
                travelAdvice = 'Normal travel conditions expected. Safe travels!';
                icon = 'fas fa-road';
            }
    }
    
    return {
        icon: icon,
        title: title,
        text: travelAdvice
    };
}

// Weather alerts function
function updateWeatherAlerts(data) {
    const alertsContainer = document.getElementById('alerts-container');
    alertsContainer.innerHTML = '';
    
    // In a real app, you would get this from the API's alerts field
    // This is a simulation based on weather conditions
    const alerts = [];
    
    if (data.weather[0].main === 'Thunderstorm') {
        alerts.push({
            event: 'Thunderstorm Warning',
            description: 'Potential for dangerous lightning, heavy rain, and possible hail. Seek shelter indoors.'
        });
    }
    
    if (data.wind.speed > 25) {
        alerts.push({
            event: 'High Wind Advisory',
            description: 'Strong winds may cause power outages and make driving difficult, especially for high-profile vehicles.'
        });
    }
    
    if (data.main.temp > 35) {
        alerts.push({
            event: 'Heat Advisory',
            description: 'Extreme heat may cause heat-related illnesses. Stay hydrated and limit outdoor activities.'
        });
    } else if (data.main.temp < -5) {
        alerts.push({
            event: 'Freeze Warning',
            description: 'Frost and freeze conditions may damage plants and create hazardous road conditions.'
        });
    }
    
    if (alerts.length === 0) {
        const noAlertCard = document.createElement('div');
        noAlertCard.className = 'alert-card';
        noAlertCard.style.background = 'rgba(46, 204, 113, 0.2)';
        noAlertCard.style.borderLeftColor = '#2ecc71';
        noAlertCard.innerHTML = `
            <i class="fas fa-check-circle alert-icon" style="color: #2ecc71"></i>
            <div class="alert-content">
                <h4 style="color: #2ecc71">No Active Alerts</h4>
                <p>No severe weather alerts for your area at this time.</p>
            </div>
        `;
        alertsContainer.appendChild(noAlertCard);
    } else {
        alerts.forEach(alert => {
            const alertCard = document.createElement('div');
            alertCard.className = 'alert-card';
            alertCard.innerHTML = `
                <i class="fas fa-exclamation-triangle alert-icon"></i>
                <div class="alert-content">
                    <h4>${alert.event}</h4>
                    <p>${alert.description}</p>
                </div>
            `;
            alertsContainer.appendChild(alertCard);
        });
    }
}

// Update air quality (simplified - actual implementation requires different API)
function updateAirQuality(lat, lon) {
    // Mock data - in a real app you would call the air pollution API
    const aqi = Math.floor(Math.random() * 150) + 1; // Random AQI between 1-150
    document.getElementById('aqi-value').textContent = aqi;
    
    updateUIStyle(aqi, 'aqi-value', 'aqi-text', [
        { max: 50, text: 'Good', color: '#2ecc71' },
        { max: 100, text: 'Moderate', color: '#f1c40f' },
        { max: 150, text: 'Unhealthy', color: '#e67e22' },
        { max: 200, text: 'Very Unhealthy', color: '#e74c3c' },
        { max: Infinity, text: 'Hazardous', color: '#8e44ad' }
    ]);
}

// Update interactive weather map
function updateWeatherMap(lat, lon) {
    const map = document.getElementById('weather-map');
    map.src = `https://openweathermap.org/weathermap?basemap=map&cities=true&layer=radar&lat=${lat}&lon=${lon}&zoom=8`;
}

// Generic function to update UI style based on value ranges
function updateUIStyle(value, valueElementId, textElementId, ranges) {
    const valueElement = document.getElementById(valueElementId);
    let bgColor = '';
    let text = '';
    
    for (const range of ranges) {
        if (value <= range.max) {
            bgColor = range.color;
            text = range.text;
            break;
        }
    }
    
    valueElement.style.backgroundColor = bgColor;
    if (textElementId) {
        document.getElementById(textElementId).textContent = text;
    }
}

// Update date display
function updateDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('date').textContent = now.toLocaleDateString('en-US', options);
}

// Show notification function
function showNotification(title, message) {
    // Check if browser supports notifications
    if (!("Notification" in window)) {
        console.log("This browser does not support desktop notification");
        return;
    }
    
    // Check if notification permissions are already granted
    if (Notification.permission === "granted") {
        new Notification(title, { body: message });
    } 
    // Otherwise, ask for permission
    else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                new Notification(title, { body: message });
            }
        });
    }
}

// Show loading spinner
function showLoading() {
    loading.style.display = 'flex';
}

// Hide loading spinner
function hideLoading() {
    loading.style.display = 'none';
}