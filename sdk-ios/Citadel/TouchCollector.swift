import Foundation
import UIKit

class TouchInterceptor: UIView {
    var onTouchBegan: ((UITouch) -> Void)?
    var onTouchEnded: ((UITouch) -> Void)?
    
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isUserInteractionEnabled = true
        isMultipleTouchEnabled = true
    }
    
    required init?(coder: NSCoder) {
        super.init(coder: coder)
        backgroundColor = .clear
        isUserInteractionEnabled = true
        isMultipleTouchEnabled = true
    }
    
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        for touch in touches {
            onTouchBegan?(touch)
        }
    }
    
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        for touch in touches {
            onTouchEnded?(touch)
        }
    }
    
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        // Pass through touches to underlying views
        return false
    }
}

class TouchCollector {
    private var bundle: SignalBundle
    private var interceptor: TouchInterceptor?
    
    init(bundle: SignalBundle) {
        self.bundle = bundle
    }
    
    func attach(view: UIView) {
        guard interceptor == nil else { return }
        
        let interceptor = TouchInterceptor(frame: view.bounds)
        interceptor.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        
        interceptor.onTouchBegan = { [weak self] touch in
            self?.handleTouch(touch, eventType: "touchstart")
        }
        
        interceptor.onTouchEnded = { [weak self] touch in
            self?.handleTouch(touch, eventType: "touchend")
        }
        
        view.addSubview(interceptor)
        self.interceptor = interceptor
    }
    
    func getTotalSignals() -> Int {
        return bundle.touchEvents.count
    }
    
    private func handleTouch(_ touch: UITouch, eventType: String) {
        let location = touch.location(in: touch.view)
        let timestampMs = Int64(touch.timestamp * 1000)
        
        let signal = TouchSignal(
            x: Double(location.x),
            y: Double(location.y),
            pressure: Double(touch.force),
            touchSize: Double(touch.majorRadius),
            eventType: eventType,
            timestamp: timestampMs
        )
        
        bundle.touchEvents.append(signal)
    }
}