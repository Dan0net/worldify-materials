import { Routes, Route, Link } from 'react-router-dom';
import { MaterialViewer } from './pages/MaterialViewer';
import { Home } from './pages/Home';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/materials" element={<MaterialViewer />} />
    </Routes>
  );
}

export default App;
